/**
 * Effective behaviour snapshots: what a run actually executed under.
 *
 * A configuration revision number alone cannot explain a run after somebody
 * edits a guidance rule or a connector's schema changes: the number moves, the
 * content it pointed at does not come back. So the snapshot records CONTENT
 * versions (identity plus last-modified instant, and for guidance the exact
 * instruction hash) rather than a pointer to mutable rows.
 *
 * Two deliberate limits:
 *
 * - **Never credentials.** Connectors contribute a name, an enabled flag and a
 *   fingerprint of their tool contract. A token or a header value never enters
 *   this table, which is read by operators and shipped in diagnostics.
 * - **Behaviour, not authority.** Freezing the snapshot preserves how Quinn
 *   was configured to speak. It grants nothing: a connector disabled, a
 *   permission revoked or a source deleted after the snapshot was taken still
 *   takes effect immediately, because the live checks run at their own
 *   boundaries and never consult this row.
 */
import { createHash } from 'node:crypto'
import { db, assistantEffectiveSnapshots, eq } from '@/lib/server/db'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { AssistantSnapshotId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import { ASSISTANT_PROMPT_VERSION } from './assistant.system-prompt'

const log = logger.child({ component: 'assistant-snapshot' })

export interface EffectiveSnapshotPayload {
  promptVersion: string
  configRevision: number
  /** The resolved assistant configuration, exactly as the turn would read it. */
  config: unknown
  /**
   * The guidance this profile would apply, by canonical entry identity.
   *
   * `version` is the entry revision the run resolved: an edit bumps it, so two
   * runs sharing an id and a version read the same instruction even after the
   * text has moved on. A run recorded while the rollback reader was active
   * carries the legacy rule ids and version 0, which is what the legacy tables
   * can honestly say about themselves.
   */
  guidance: Array<{
    id: string
    name: string
    contentHash: string
    version: number
    source: 'canonical' | 'legacy'
    updatedAt: string | null
  }>
  /** Packaged procedures the turn could load, by the same identity. */
  skills: Array<{
    id: string
    name: string
    version: number
    source: 'canonical' | 'legacy'
    updatedAt: string | null
  }>
  /**
   * Contract fingerprints and the policy the run resolved under. Never a
   * credential, a token or a header value. `policyVersion` and `policyHash`
   * are what make a run explainable after somebody edits permissions: the
   * version says which edit, the hash says whether the content actually moved.
   */
  connectors: Array<{
    id: string
    name: string
    enabled: boolean
    contractHash: string
    policyVersion: number
    catalogRevision: number
    policyHash: string
  }>
  retrieval: { sourceTypes: string[] }
  validator: { mode: 'structural' }
}

/** Stable JSON: object keys sorted at every depth, so an unordered read still hashes alike. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
  return `{${entries.join(',')}}`
}

export function snapshotContentHash(payload: EffectiveSnapshotPayload): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

/**
 * Resolve the behaviour this workspace would apply to a customer-support turn.
 *
 * Every read is best-effort in the same direction the runtime already fails:
 * a source that cannot be read contributes nothing rather than failing the
 * turn, and the omission is visible in the snapshot as an absent section.
 */
export async function buildEffectiveSnapshot(): Promise<EffectiveSnapshotPayload> {
  const { getAssistantRuntimeConfig } =
    await import('@/lib/server/domains/settings/settings.assistant')
  let config: unknown = null
  let configRevision = 0
  try {
    const runtime = await getAssistantRuntimeConfig()
    config = runtime.config
    configRevision = runtime.revision
  } catch (err) {
    log.warn({ err }, 'snapshot could not read the assistant config')
  }

  const guidance: EffectiveSnapshotPayload['guidance'] = []
  try {
    const { listEnabledGuidanceCandidates } = await import('./guidance.service')
    // Customer-support runs are the only durable ones today, and they resolve
    // the `agent` profile. A second role gets its own call when it gets a
    // durable path, rather than a parameter nothing passes.
    const rules = await listEnabledGuidanceCandidates({ agent: 'agent' })
    for (const rule of rules) {
      guidance.push({
        id: rule.id,
        name: rule.name,
        contentHash: shortHash(rule.instruction ?? ''),
        version: rule.version,
        source: rule.source,
        updatedAt: rule.updatedAt ? new Date(rule.updatedAt).toISOString() : null,
      })
    }
  } catch (err) {
    log.warn({ err }, 'snapshot could not read guidance')
  }

  const skills: EffectiveSnapshotPayload['skills'] = []
  try {
    const { guidanceSource } = await import('./guidance-source')
    if (guidanceSource() === 'canonical') {
      const { listCanonicalProcedures } = await import('./guidance-entries.service')
      // Same profile as the guidance above: customer-support runs are the only
      // durable ones today, and a procedure bound to another profile is not
      // part of what this run could have loaded.
      for (const procedure of await listCanonicalProcedures('agent')) {
        skills.push({
          id: procedure.id,
          name: procedure.name,
          version: procedure.version,
          source: 'canonical',
          updatedAt: procedure.updatedAt ? new Date(procedure.updatedAt).toISOString() : null,
        })
      }
    } else {
      const { listSkills } = await import('./skills.service')
      for (const skill of await listSkills()) {
        skills.push({
          id: skill.id,
          name: skill.name,
          version: 0,
          source: 'legacy',
          updatedAt: skill.updatedAt ? new Date(skill.updatedAt).toISOString() : null,
        })
      }
    }
  } catch (err) {
    log.warn({ err }, 'snapshot could not read skills')
  }

  const connectors: EffectiveSnapshotPayload['connectors'] = []
  try {
    const { listConnectors } = await import('./connectors/connectors.service')
    for (const connector of await listConnectors()) {
      const { effectiveConnectorPolicyState } = await import('./connectors/connector-policy-state')
      const policyState = effectiveConnectorPolicyState(connector)
      connectors.push({
        id: connector.id,
        name: connector.name,
        enabled: connector.enabled !== false,
        policyVersion: connector.policyVersion,
        catalogRevision: connector.catalogRevision,
        // Per-use policies and reviewed contracts together: two runs sharing
        // this hash resolved every tool the same way for every use.
        policyHash: shortHash(
          canonicalJson({
            policies: policyState.profilePolicies,
            reviews: policyState.toolReviews,
          })
        ),
        // Identity and shape only. Credentials live in the connector's own
        // secret storage and are never read here.
        contractHash: shortHash(
          canonicalJson({
            id: connector.id,
            tools: (connector.tools ?? []).map((tool) => tool.name).sort(),
            updatedAt: connector.updatedAt ? new Date(connector.updatedAt).toISOString() : null,
          })
        ),
      })
    }
  } catch (err) {
    log.warn({ err }, 'snapshot could not read connectors')
  }

  return {
    promptVersion: ASSISTANT_PROMPT_VERSION,
    configRevision,
    config,
    guidance,
    skills,
    connectors,
    retrieval: { sourceTypes: [] },
    // Structural validation is what ships today. The semantic verifier arrives
    // in shadow mode later; recording the mode now means an old run is never
    // mistaken for one that passed a check that did not exist.
    validator: { mode: 'structural' },
  }
}

/**
 * Persist a snapshot, reusing the row an identical payload already has.
 *
 * Deduplicated by content hash rather than by revision: a workspace whose
 * behaviour has not changed accumulates one row, and two runs pointing at the
 * same row is positive evidence that they behaved the same.
 */
export async function persistEffectiveSnapshot(
  payload: EffectiveSnapshotPayload,
  exec: Executor = db
): Promise<AssistantSnapshotId> {
  const contentHash = snapshotContentHash(payload)
  const inserted = await exec
    .insert(assistantEffectiveSnapshots)
    .values({ contentHash, payload: payload as unknown as Record<string, unknown> })
    .onConflictDoNothing({ target: assistantEffectiveSnapshots.contentHash })
    .returning({ id: assistantEffectiveSnapshots.id })
  if (inserted.length > 0) return inserted[0].id
  const [existing] = await exec
    .select({ id: assistantEffectiveSnapshots.id })
    .from(assistantEffectiveSnapshots)
    .where(eq(assistantEffectiveSnapshots.contentHash, contentHash))
    .limit(1)
  if (!existing) throw new Error('effective snapshot neither inserted nor found')
  return existing.id
}
