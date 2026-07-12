/**
 * Shadow-diff harness (EVENTING-V2 WO-15) — the safety net for the Phase 5
 * cutover. It runs BOTH target resolvers for the same event and reports any
 * divergence, so the deletions in WO-18 only happen once the new resolver
 * registry provably reproduces the legacy getHookTargets() output.
 *
 * Usage:
 *  - unit: diffTargets() is pure and tested directly.
 *  - staging dry-run: shadowDiffForEvent() runs both paths and logs any
 *    divergence WITHOUT delivering (call it from the relay path behind the flag,
 *    or a one-off script over recent outbox rows). Zero divergence across a full
 *    soak window is the gate to flip the flag default on and then delete.
 *
 * The 'workflow' sink is excluded from the comparison: the legacy path never
 * produced workflow HOOK targets (workflows dispatched via their own queue), so
 * the new workflowTriggerResolver's targets are expected-and-correct extras.
 */
import { logger } from '@/lib/server/logger'
import { resolveTargets } from './resolvers/registry'
import { toLegacyEvent } from './to-legacy-event'
import type { HookTarget } from './hook-types'
import type { DomainEvent } from './envelope'

const log = logger.child({ component: 'shadow-diff' })

export interface ShadowDiff {
  equal: boolean
  onlyLegacy: HookTarget[]
  onlyNew: HookTarget[]
}

/** Order-independent key for a target: {type, target, config} with sorted keys. */
function targetKey(t: HookTarget): string {
  return stableStringify({ type: t.type, target: t.target, config: t.config })
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/**
 * Multiset diff of two target lists. `fresh` has its 'workflow' targets stripped
 * first (see module doc). Returns the targets present in only one side.
 */
export function diffTargets(legacy: HookTarget[], fresh: HookTarget[]): ShadowDiff {
  const comparableFresh = fresh.filter((t) => t.type !== 'workflow')

  const count = (list: HookTarget[]): Map<string, number> => {
    const m = new Map<string, number>()
    for (const t of list) m.set(targetKey(t), (m.get(targetKey(t)) ?? 0) + 1)
    return m
  }
  const legacyCounts = count(legacy)
  const freshCounts = count(comparableFresh)

  const onlyLegacy: HookTarget[] = []
  const onlyNew: HookTarget[] = []
  for (const t of legacy) {
    const k = targetKey(t)
    if ((freshCounts.get(k) ?? 0) < (legacyCounts.get(k) ?? 0)) {
      onlyLegacy.push(t)
      legacyCounts.set(k, (legacyCounts.get(k) ?? 0) - 1)
    }
  }
  for (const t of comparableFresh) {
    const k = targetKey(t)
    if ((legacyCounts.get(k) ?? 0) < (freshCounts.get(k) ?? 0)) {
      onlyNew.push(t)
      freshCounts.set(k, (freshCounts.get(k) ?? 0) - 1)
    }
  }

  return { equal: onlyLegacy.length === 0 && onlyNew.length === 0, onlyLegacy, onlyNew }
}

/**
 * Run both resolvers for an event and log any divergence. Dry-run only — never
 * delivers. Returns the diff for programmatic soak checks. Safe to call
 * best-effort; a failure logs and reports equal (so it never blocks delivery).
 */
export async function shadowDiffForEvent(event: DomainEvent): Promise<ShadowDiff> {
  try {
    const { getHookTargets } = await import('./targets')
    const [legacy, fresh] = await Promise.all([
      getHookTargets(toLegacyEvent(event)),
      resolveTargets(event),
    ])
    const diff = diffTargets(legacy, fresh)
    if (!diff.equal) {
      log.warn(
        {
          type: event.type,
          event_id: event.eventId,
          only_legacy: diff.onlyLegacy.map((t) => t.type),
          only_new: diff.onlyNew.map((t) => t.type),
        },
        'shadow-diff divergence — resolver registry does not match getHookTargets'
      )
    }
    return diff
  } catch (error) {
    log.error({ err: error, type: event.type }, 'shadow-diff failed')
    return { equal: true, onlyLegacy: [], onlyNew: [] }
  }
}
