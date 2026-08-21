/**
 * Refusals a retry cannot fix, and what to do instead of retrying.
 *
 * ## The measurement
 *
 * Two workspaces on a live fleet were refused with `app_secret_no_resolver` — their
 * `appSecretsRef` names a secret store this build has no resolver for. The tiers
 * reconnected anyway. One of them was the **most active database in the fleet at
 * 70%**, its newest connection 1.6 seconds old, doing no work of any kind. A
 * configuration-terminal refusal was being answered by a reconnect loop at the
 * poll interval, and the cost was a compute that could never suspend.
 *
 * ## The rule
 *
 * Classify, then choose the wait. `fingerprint.ts` already draws the line
 * between the two subjects of a refusal (wrong database vs wrong key) and now
 * also answers the second question — can a retry change this? Everything it
 * calls terminal is an accusation about a record or a key, and this module adds
 * the codes the secret resolver raises before a fingerprint is ever taken.
 *
 * - **Terminal** → stop retrying. Resume when the workspace's registry `revision`
 *   changes, because the control plane's trigger bumps it on any write to the
 *   record — including the hand-run `UPDATE` that fixes it. Re-probe once per
 *   `rescanIntervalMs` regardless, because not every repair is a registry
 *   change: a custody repair writes the *workspace* database and leaves the record
 *   untouched, and a workspace that could only ever be freed by a revision bump
 *   would stay refused after being fixed.
 * - **Transient** → exponential backoff, capped. A compute that is still
 *   starting, a schema floor the migrator has not reached yet, a credential
 *   mid-rotation: all of these heal on their own, and all of them are made worse
 *   by a tight loop.
 *
 * ## Visibility is the hard requirement, not the wait
 *
 * A workspace that stops being retried and says nothing is worse than the retry
 * storm, because the storm at least had a symptom. So quarantine is loud on
 * entry, loud again on a fixed heartbeat for as long as it lasts, and readable
 * from the tier status the readiness probe already publishes. The heartbeat is
 * the part that matters: entry logs scroll away, and the operator who needs this
 * is the one arriving hours later asking why a workspace is not being served.
 */
import { logger } from '@/lib/server/logger'
import { isTerminalRefusalCode } from './fingerprint'

const log = logger.child({ component: 'workspace-quarantine' })

export type RefusalDisposition = 'terminal' | 'transient'

/**
 * Refusal codes raised before a fingerprint is ever taken.
 *
 * These come from `vendor/workspace-secret-resolution.ts`, which is vendored
 * byte-for-byte from the control plane and must stay that way — so the codes are
 * matched as strings here rather than imported as a union. The parity test is
 * what keeps the strings honest; a code that is renamed upstream shows up as a
 * vendored-file digest change, which is a review, which is where this list gets
 * read.
 *
 * All terminal, and for one reason: each names a *ref* that is wrong, or a
 * resolver this build does not have. Reconnecting re-reads the same ref with the
 * same code and reaches the same conclusion.
 */
const TERMINAL_SECRET_CODES: ReadonlySet<string> = new Set([
  // `derived+hkdf://` and `env://` are the schemes this fleet implements. Any
  // other names a store nothing here can reach.
  'app_secret_no_resolver',
  // The named variable is unset in this process. A restart is the only thing
  // that changes it, and a restart empties this map anyway.
  'app_secret_unresolvable',
  'ref_workspace_key_mismatch',
  'ref_purpose_mismatch',
  'root_key_missing',
  'bad_workspace',
])

/**
 * Postgres SQLSTATEs that mean the DSN names something that is not there.
 *
 * Deliberately short. `28P01` (bad password) is absent because a rotation heals
 * it without any record change, and `57P03` (cannot connect now) is absent
 * because it is what a starting compute says.
 */
const TERMINAL_SQLSTATES: ReadonlySet<string> = new Set([
  '3D000', // invalid_catalog_name — no such database
  '3F000', // invalid_schema_name
])

/**
 * Terminal or transient?
 *
 * Unknown codes are transient. That is the fail-open direction: an unrecognised
 * terminal failure costs a bounded backoff, while an unrecognised transient one
 * wrongly quarantined costs a workspace its service until a human notices.
 */
export function classifyRefusal(code: string): RefusalDisposition {
  if (isTerminalRefusalCode(code)) return 'terminal'
  if (TERMINAL_SECRET_CODES.has(code)) return 'terminal'
  if (TERMINAL_SQLSTATES.has(code)) return 'terminal'
  return 'transient'
}

/** Pull the code off whatever was thrown. Every refusal path carries one. */
export function refusalCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' && code !== '' ? code : 'pool_unavailable'
}

export interface QuarantineEntry {
  workspaceKey: string
  /** The revision the refusal was observed at. A different one clears it. */
  revision: number
  code: string
  disposition: RefusalDisposition
  detail: string
  firstRefusedAt: number
  lastRefusedAt: number
  attempts: number
  /** Epoch ms before which this workspace must not be retried. */
  retryAfter: number
}

/**
 * Transient backoff: the poll interval doubling to a minute.
 *
 * A minute rather than something longer because a transient failure is by
 * definition one that heals, and the cost of asking again is one connection to a
 * compute that is either already awake (it is starting) or about to be needed.
 */
const TRANSIENT_BACKOFF_FLOOR_MS = 1_000
const TRANSIENT_BACKOFF_CEILING_MS = 60_000

/** How often the quarantine heartbeat repeats itself while anything is in it. */
const REPORT_INTERVAL_MS = 300_000

const quarantined = new Map<string, QuarantineEntry>()
let lastReportAt = 0

export interface WorkspaceIdentity {
  workspaceKey: string
  revision: number
}

/**
 * Record a refusal and decide when this workspace may be tried again.
 *
 * Returns the entry so a caller can log the disposition alongside its own
 * context rather than correlating two lines.
 */
export function noteWorkspaceRefusal(
  workspace: WorkspaceIdentity,
  code: string,
  detail: string
): QuarantineEntry {
  const disposition = classifyRefusal(code)
  const now = Date.now()
  const previous = quarantined.get(workspace.workspaceKey)
  // A record that changed is a different question. Start the count again rather
  // than carrying a backoff earned by the old one.
  const carried = previous && previous.revision === workspace.revision ? previous : null
  const attempts = (carried?.attempts ?? 0) + 1

  const retryAfter =
    disposition === 'terminal'
      ? now + 900_000
      : now +
        Math.min(TRANSIENT_BACKOFF_CEILING_MS, TRANSIENT_BACKOFF_FLOOR_MS * 2 ** (attempts - 1))

  const entry: QuarantineEntry = {
    workspaceKey: workspace.workspaceKey,
    revision: workspace.revision,
    code,
    disposition,
    detail,
    firstRefusedAt: carried?.firstRefusedAt ?? now,
    lastRefusedAt: now,
    attempts,
    retryAfter,
  }
  quarantined.set(workspace.workspaceKey, entry)

  if (disposition === 'terminal' && !carried) {
    log.error(
      {
        workspaceKey: workspace.workspaceKey,
        revision: workspace.revision,
        code,
        detail,
        retryAfterMs: retryAfter - now,
      },
      'workspace refused for a reason no retry can fix — it will NOT be reconnected. It resumes ' +
        'when its registry record changes (any write bumps revision), or on the next re-probe. ' +
        'Until then this workspace is not being served by this tier.'
    )
  }
  return entry
}

/** Clear a workspace that has just been served successfully. */
export function noteWorkspaceServed(workspaceKey: string): void {
  const entry = quarantined.get(workspaceKey)
  if (!entry) return
  quarantined.delete(workspaceKey)
  log.info(
    { workspaceKey, code: entry.code, refusedForMs: Date.now() - entry.firstRefusedAt },
    'workspace left quarantine — it is being served again'
  )
}

/**
 * Should this workspace be skipped right now?
 *
 * A revision change always clears the entry, whatever the disposition and
 * whatever the backoff: the record is the thing the refusal was about, so a
 * changed record deserves a fresh attempt immediately.
 */
export function isWorkspaceQuarantined(workspace: WorkspaceIdentity, now = Date.now()): boolean {
  const entry = quarantined.get(workspace.workspaceKey)
  if (!entry) return false
  if (entry.revision !== workspace.revision) {
    quarantined.delete(workspace.workspaceKey)
    log.info(
      { workspaceKey: workspace.workspaceKey, from: entry.revision, to: workspace.revision, code: entry.code },
      'quarantined workspace record changed — retrying it now'
    )
    return false
  }
  return now < entry.retryAfter
}

/**
 * When this workspace may next be tried, or null if it is not quarantined.
 *
 * Exported so a detached loop can sleep exactly that long instead of waking on
 * a timer to be told "not yet" — a refused workspace should cost this process
 * nothing at all, including timers.
 */
export function quarantineRetryAt(workspaceKey: string): number | null {
  return quarantined.get(workspaceKey)?.retryAfter ?? null
}

export function listQuarantinedWorkspaces(): QuarantineEntry[] {
  return [...quarantined.values()]
}

/**
 * The heartbeat. Called from the tiers' refresh pass, so it runs on a cadence
 * that exists whether or not anything is wrong.
 *
 * Silent when the set is empty — a periodic "nothing is refused" line is how a
 * log gets filtered out, taking the line that mattered with it.
 */
export function reportQuarantine(now = Date.now()): void {
  if (quarantined.size === 0) return
  if (now - lastReportAt < REPORT_INTERVAL_MS) return
  lastReportAt = now
  log.error(
    {
      count: quarantined.size,
      workspaces: [...quarantined.values()].map((e) => ({
        workspaceKey: e.workspaceKey,
        code: e.code,
        disposition: e.disposition,
        revision: e.revision,
        refusedForMs: now - e.firstRefusedAt,
        attempts: e.attempts,
      })),
    },
    'workspaces are still being refused and are not being served'
  )
}

/** Test seam: forget every entry and the heartbeat clock. */
export function __resetQuarantineForTests(): void {
  quarantined.clear()
  lastReportAt = 0
}
