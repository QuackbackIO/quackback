/**
 * Release vocabulary shared by the server and the review screens.
 *
 * Everything here is pure. The publication gate in particular has to be
 * decidable from the stored rows alone: the server refuses a publication with
 * it and the page explains a blocked publish with the same function, so the two
 * cannot drift into disagreeing about what "ready" means.
 */

/** Mirrors `assistant_release_checks.status`. Kept here so client code needs no schema import. */
export type ReleaseCheckStatus =
  'running' | 'passed' | 'failed' | 'skipped' | 'inconclusive' | 'cancelled'

export type ReleaseCheckKey = 'configuration' | 'toolset' | 'answer_sandbox'

export interface ReleaseCheckDefinition {
  key: ReleaseCheckKey
  label: string
  /**
   * A required check must have passed against the exact candidate before it can
   * be published. Optional checks are reported and never gate, which is what
   * "model suites are opt-in" means: a suite that needs a provider cannot be
   * allowed to decide whether a workspace may ship a wording change.
   */
  required: boolean
}

/**
 * The catalogue.
 *
 * Two deterministic checks that run anywhere, and one that needs a live model
 * and is therefore reported rather than required.
 */
export const RELEASE_CHECKS: readonly ReleaseCheckDefinition[] = [
  { key: 'configuration', label: 'Configuration', required: true },
  { key: 'toolset', label: 'Actions', required: true },
  { key: 'answer_sandbox', label: 'Sample answer', required: false },
]

export interface ReleaseCheckResult {
  key: string
  status: ReleaseCheckStatus
  /** The candidate this result was produced against. */
  candidateHash: string
  summary: string | null
  ranAt: string
}

/** Why a required check is not evidence for this candidate. */
export type ReleaseBlockReason = 'not_run' | 'stale' | ReleaseCheckStatus

export interface ReleaseGate {
  publishable: boolean
  blocking: Array<{ key: ReleaseCheckKey; reason: ReleaseBlockReason }>
}

/**
 * Can this candidate be published?
 *
 * Only a `passed` result recorded against this exact candidate hash counts. A
 * missing row, a row from an earlier candidate, and every other verdict block,
 * each under its own reason, because "not run yet" and "run and skipped" are
 * different things to a reviewer even though both stop the publish.
 */
export function evaluateReleaseGate(
  candidateHash: string,
  results: readonly ReleaseCheckResult[]
): ReleaseGate {
  const byKey = new Map(results.map((result) => [result.key, result]))
  const blocking: ReleaseGate['blocking'] = []
  for (const check of RELEASE_CHECKS) {
    if (!check.required) continue
    const result = byKey.get(check.key)
    if (!result) {
      blocking.push({ key: check.key, reason: 'not_run' })
      continue
    }
    if (result.candidateHash !== candidateHash) {
      blocking.push({ key: check.key, reason: 'stale' })
      continue
    }
    if (result.status !== 'passed') blocking.push({ key: check.key, reason: result.status })
  }
  return { publishable: blocking.length === 0, blocking }
}

/** How a recorded result reads against the candidate on screen. */
export function readingForCheck(
  candidateHash: string,
  result: ReleaseCheckResult | undefined
): ReleaseBlockReason | 'passed' {
  if (!result) return 'not_run'
  if (result.candidateHash !== candidateHash) return 'stale'
  return result.status
}

/** The uses a configuration change reaches. */
export type ReleaseUse = 'customer' | 'teammate' | 'workspace'

const USE_ORDER: readonly ReleaseUse[] = ['customer', 'teammate', 'workspace']

/** A reviewer reads a scope, not a hundred leaf paths. */
const MAX_CHANGED_PATHS = 50

export interface ReleaseScope {
  uses: ReleaseUse[]
  changedPaths: string[]
}

/**
 * Which uses a changed path belongs to.
 *
 * Identity is Quinn's name and avatar and is worn in front of both audiences,
 * so it counts for both. Everything else is owned by exactly one profile. A
 * path nothing claims (the config's own `version`, say) affects no use and is
 * left out rather than being attributed to all of them.
 */
function usesForPath(path: string): ReleaseUse[] {
  if (path === 'identity' || path.startsWith('identity.')) return ['customer', 'teammate']
  if (path.startsWith('agents.agent')) return ['customer']
  if (path.startsWith('agents.copilot')) return ['teammate']
  if (path.startsWith('agents.workspace')) return ['workspace']
  return []
}

function changedLeafPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (Object.is(before, after)) return []
  const beforeObject =
    typeof before === 'object' && before !== null && !Array.isArray(before)
      ? (before as Record<string, unknown>)
      : null
  const afterObject =
    typeof after === 'object' && after !== null && !Array.isArray(after)
      ? (after as Record<string, unknown>)
      : null
  if (!beforeObject || !afterObject) {
    if (!prefix) return []
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [prefix]
  }
  const paths: string[] = []
  const keys = new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])
  for (const key of [...keys].sort()) {
    paths.push(
      ...changedLeafPaths(beforeObject[key], afterObject[key], prefix ? `${prefix}.${key}` : key)
    )
  }
  return paths
}

/**
 * The affected-use diff between the live configuration and a candidate.
 *
 * The path list is what the publish review shows and is bounded; the use list
 * is computed from every changed path before the bound is applied, so trimming
 * the display can never shrink the scope a reviewer is told about.
 */
export function releaseAffectedUses(live: unknown, candidate: unknown): ReleaseScope {
  const changed = changedLeafPaths(live, candidate)
  const uses = new Set<ReleaseUse>()
  for (const path of changed) for (const use of usesForPath(path)) uses.add(use)
  return {
    uses: USE_ORDER.filter((use) => uses.has(use)),
    changedPaths: changed.slice(0, MAX_CHANGED_PATHS),
  }
}

/** Plain labels for the three uses, so server and screen agree on the words. */
export const RELEASE_USE_LABELS: Record<ReleaseUse, string> = {
  customer: 'Customer conversations',
  teammate: 'Support teammates',
  workspace: 'Workspace and Slack',
}
