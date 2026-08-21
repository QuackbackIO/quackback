/**
 * Asking a workspace database who it belongs to, and deciding whether to believe it.
 *
 * SAAS-HOSTING-STACK.md §3, stated plainly: if workspace resolution returns the
 * wrong pool, every RBAC and permission check still passes, because that
 * database's own `settings`, `principal` and `roles` rows are entirely
 * self-consistent. It does not error. It looks correct. There is no second gate,
 * so this is the gate.
 *
 * Three independent facts are checked, and each covers a hole in the others:
 *
 * | Fact | Written by | Beaten by |
 * | --- | --- | --- |
 * | `settings.id` | nobody — it is a primary key | a copy of the database |
 * | the control plane's stamp | the CP, deliberately | a copy of the database |
 * | `pg_database.oid` | the catalog, per database | nothing we can reach |
 *
 * The verdict for the first two is `evaluateFingerprint`, vendored byte-for-byte
 * from the control plane so both sides run the same predicate rather than two
 * prose readings of it. The third is `evaluatePhysicalIdentity`, which exists
 * because branching copies data and therefore copies both of the first two.
 *
 * ## Where the stamp is read from
 *
 * Preferentially from `settings.cloud_workspace_key`, a dedicated column
 * (migration 0256). The stamp's original home is the `settings.metadata` JSON
 * bag, and `telemetry/instance-id.ts` performs an unlocked, unattended **hourly**
 * read-modify-write of that same bag which never invalidates the settings cache —
 * so it can interleave with a stamp write and drop it. A column removes the whole
 * class rather than narrowing the window.
 *
 * The column is read through `to_jsonb(s) ->> 'cloud_workspace_key'` rather than by
 * name, so this query still runs against a database that predates 0256 and
 * simply reports the column as absent. That matters because the fingerprint is
 * the *first* thing a pooled process does with a workspace database — refusing to
 * even look because of an ordering problem would turn an expand-only migration
 * into an outage.
 *
 * When both sources are present and disagree, that is a refusal in its own
 * right: two writers claiming different owners is not a state to pick a winner
 * from.
 */
import type { Sql } from 'postgres'
import {
  WORKSPACE_FINGERPRINT_METADATA_KEY,
  evaluateFingerprint,
  workspaceFingerprintStampSchema,
  type FingerprintFailure,
  type ObservedFingerprint,
  type WorkspaceFingerprintExpectation,
  type WorkspaceFingerprintStamp,
} from './vendor/contract'
import {
  evaluatePhysicalIdentity,
  type ObservedPhysicalIdentity,
  type PhysicalExpectation,
  type PhysicalFailure,
} from './physical-identity'
import { verifySecretKeyCanary } from './vendor/fleet-secrets'
import { probeStoredCiphertext, type StoredCiphertextProbe } from './stored-ciphertext'

/** Where the workspace id was read from, for the refusal log. */
export type StampSource = 'column' | 'metadata' | 'none'

export interface WorkspaceIdentityObservation extends ObservedFingerprint {
  physical: ObservedPhysicalIdentity
  stampSource: StampSource
  /** Both sources present and naming different workspaces. */
  stampSourceConflict: { column: string; metadata: string } | null
  /**
   * `settings.cloud_secret_canary` — a constant sealed under this workspace's own
   * `SECRET_KEY`. Null on a self-hosted install and on a database that predates
   * migration 0252.
   */
  secretCanary: string | null
  /**
   * The same key, tried against ciphertext this database was already holding.
   *
   * The canary is minted by whoever last took custody, so it attests only that
   * this process holds the key the canary was sealed with. This is the fact it
   * cannot supply: whether that key is the one the workspace's *stored* data was
   * written under. See `stored-ciphertext.ts` for which value is sampled.
   */
  storedCiphertext: StoredCiphertextProbe
}

export type IdentityFailure =
  | FingerprintFailure
  | PhysicalFailure
  | 'stamp_source_conflict'
  | 'secret_key_canary_missing'
  | 'secret_key_canary_mismatch'
  | 'secret_key_stored_ciphertext_mismatch'
  | 'secret_key_custody_unproven'

/**
 * What each refusal code is actually an accusation about.
 *
 * `acquireWorkspaceScope` funnels EVERY exception from pool checkout into one
 * `refused` variant with a `code`, and the caller used to treat that variant as
 * synonymous with a fingerprint refusal. It is not: a missing credential, an
 * unreachable compute or a misconfigured `MIN_SCHEMA_VERSION` all arrive there
 * too, and reporting one of those as a fingerprint failure pulls the alarm
 * reserved for a cross-workspace near-miss — the one an operator is trained to
 * read as a workspaces breach.
 *
 * Two subjects, not one. `database` codes mean the row in front of us belongs
 * to someone else; `key` codes mean the row may be exactly right while the key
 * we would encrypt under is not the one its stored ciphertext was written with.
 * `evaluateSecretKeyCanary` keeps that distinction deliberately, on the grounds
 * that the operator fix for the two is nothing alike, and collapsing them here
 * would undo it at the only place an operator reads.
 */
const IDENTITY_FAILURE_SUBJECT = {
  settings_row_missing: 'database',
  settings_not_singleton: 'database',
  stamp_missing: 'database',
  stamp_workspace_key_mismatch: 'database',
  self_reported_workspace_id_mismatch: 'database',
  catalog_name_mismatch: 'database',
  catalog_oid_mismatch: 'database',
  stamp_source_conflict: 'database',
  secret_key_canary_missing: 'key',
  secret_key_canary_mismatch: 'key',
  secret_key_stored_ciphertext_mismatch: 'key',
  secret_key_custody_unproven: 'key',
} as const satisfies Record<IdentityFailure, 'database' | 'key'>

/**
 * The codes that mean "this is the wrong database", derived rather than
 * restated so the two lists cannot drift apart.
 *
 * `Record<IdentityFailure, …>` above is the compile-time gate: a new failure
 * code fails to compile until it is classified, and it cannot be classified
 * without someone deciding which alarm it belongs to. That is the property
 * worth keeping. A hand-maintained second list would let a new code be added
 * to the union and silently default to neither.
 */
export const IDENTITY_FAILURE_CODES = Object.keys(IDENTITY_FAILURE_SUBJECT).filter(
  (code) => IDENTITY_FAILURE_SUBJECT[code as IdentityFailure] === 'database'
) as readonly IdentityFailure[]

/** The codes that mean "the key and the database do not belong to each other". */
export const KEY_CUSTODY_FAILURE_CODES = Object.keys(IDENTITY_FAILURE_SUBJECT).filter(
  (code) => IDENTITY_FAILURE_SUBJECT[code as IdentityFailure] === 'key'
) as readonly IdentityFailure[]

/** True when a refusal code means the database failed its identity check. */
export function isIdentityFailureCode(code: string): code is IdentityFailure {
  return IDENTITY_FAILURE_SUBJECT[code as IdentityFailure] === 'database'
}

/**
 * True when a refusal code means the key and the database do not belong to each
 * other. Distinct from {@link isIdentityFailureCode} because the cross-workspace
 * alarm is trained on the other one, and the repair is a custody script rather
 * than a registry correction.
 */
export function isKeyCustodyFailureCode(code: string): code is IdentityFailure {
  return IDENTITY_FAILURE_SUBJECT[code as IdentityFailure] === 'key'
}

/**
 * The second question about a refusal: can retrying ever fix it?
 *
 * A separate axis from the subject above, and it has to be, because the two do
 * not correlate. The subject decides which alarm an operator reads; this decides
 * whether the fleet should keep asking. Measured consequence of not having it:
 * a workspace refused for a configuration reason was reconnected **once per
 * second**, holding its compute at 70% active for zero work, indefinitely.
 *
 * Every code here is `terminal`, and that is a finding rather than a shortcut.
 * Each one is an accusation about a *record* or a *key* — the database in front
 * of us is not the one the registry named, or the key we hold is not the one its
 * ciphertext was written under. Neither is a state a connection attempt changes.
 * The map is exhaustive anyway, for the same reason the subject map is: a new
 * code cannot be added to `IdentityFailure` without someone deciding this
 * question, and a code that genuinely IS transient (a read that failed because
 * the compute was still starting, say) must not inherit "terminal" by default.
 */
const IDENTITY_FAILURE_RETRYABILITY = {
  settings_row_missing: 'terminal',
  settings_not_singleton: 'terminal',
  stamp_missing: 'terminal',
  stamp_workspace_key_mismatch: 'terminal',
  self_reported_workspace_id_mismatch: 'terminal',
  catalog_name_mismatch: 'terminal',
  catalog_oid_mismatch: 'terminal',
  stamp_source_conflict: 'terminal',
  secret_key_canary_missing: 'terminal',
  secret_key_canary_mismatch: 'terminal',
  secret_key_stored_ciphertext_mismatch: 'terminal',
  secret_key_custody_unproven: 'terminal',
} as const satisfies Record<IdentityFailure, 'terminal' | 'transient'>

/**
 * True when a refusal code names a state no reconnection can change.
 *
 * Returns false for anything it does not recognise, which is the fail-open
 * direction on purpose: an unknown code that is really terminal costs a bounded
 * backoff, while an unknown code wrongly called terminal costs a workspace its
 * service until an operator notices.
 */
export function isTerminalRefusalCode(code: string): boolean {
  return IDENTITY_FAILURE_RETRYABILITY[code as IdentityFailure] === 'terminal'
}

export type IdentityVerdict = { ok: true } | { ok: false; code: IdentityFailure; detail: string }

/** Thrown by the pool cache when a workspace database fails its own fingerprint. */
export class WorkspaceFingerprintRefusal extends Error {
  readonly code: IdentityFailure
  readonly workspaceKey: string
  constructor(workspaceKey: string, code: IdentityFailure, detail: string) {
    super(`REFUSED [${code}] ${detail}`)
    this.name = 'WorkspaceFingerprintRefusal'
    this.code = code
    this.workspaceKey = workspaceKey
  }
}

interface SettingsIdentityRow {
  id: string
  metadata: string | null
  cloud_workspace_key: string | null
  cloud_secret_canary: string | null
  stored_ciphertext: string | null
}

/**
 * The settings read, with a sample of the workspace's own ciphertext riding along.
 *
 * The sample is a correlated subquery in the *same statement*, so the evidence
 * the key check needs costs no extra round trip on the checkout path.
 *
 * `jwks` is created by migration 0001, one step behind `settings` itself, so a
 * database that has this query's `FROM` but not its subquery is one that never
 * finished provisioning. That is still not a reason to hard-fail: this is the
 * first thing a pooled process does with a workspace database, and refusing to even
 * look because a table arrived a migration later is how an ordering problem
 * becomes an outage. So the one error that means exactly that — `42P01`,
 * undefined table — falls back to the settings-only read, and the workspace is
 * reported as having nothing sampled rather than as suspect.
 *
 * The oldest key is sampled, not the newest, and that is the load-bearing
 * detail. A rotation writes a new row under whatever key is in force, so a
 * fleet holding the wrong key would mint a fresh row it *can* open and the check
 * would congratulate itself. The oldest row is the one written furthest back,
 * under the custody this database's data actually belongs to.
 */
async function readSettingsIdentity(sql: Sql): Promise<SettingsIdentityRow[]> {
  // LIMIT 2 rather than count(*): one round trip, and it distinguishes 0, 1 and
  // "more than one", which is all the verdict needs.
  try {
    return (await sql`
      SELECT s.id::text AS id,
             s.metadata,
             (to_jsonb(s) ->> 'cloud_workspace_key')     AS cloud_workspace_key,
             (to_jsonb(s) ->> 'cloud_secret_canary') AS cloud_secret_canary,
             (SELECT j.private_key
                FROM jwks j
               ORDER BY j.created_at ASC, j.id ASC
               LIMIT 1)                              AS stored_ciphertext
        FROM settings s
       LIMIT 2
    `) as unknown as SettingsIdentityRow[]
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== '42P01') throw err
    const rows = (await sql`
      SELECT s.id::text AS id,
             s.metadata,
             (to_jsonb(s) ->> 'cloud_workspace_key')     AS cloud_workspace_key,
             (to_jsonb(s) ->> 'cloud_secret_canary') AS cloud_secret_canary
        FROM settings s
       LIMIT 2
    `) as unknown as Omit<SettingsIdentityRow, 'stored_ciphertext'>[]
    return rows.map((row) => ({ ...row, stored_ciphertext: null }))
  }
}

/**
 * Read what a workspace database says about itself. Observations only, never a
 * verdict — the verdict lives in exactly one place.
 *
 * `secretKey` is the key this process resolved for the workspace and is about to
 * put into service. It is taken here rather than at the verdict because opening
 * a sample is I/O-shaped and the verdict is a pure function; what crosses the
 * boundary is which of four things happened, never the plaintext.
 */
export async function observeWorkspaceIdentity(
  sql: Sql,
  secretKey: string
): Promise<WorkspaceIdentityObservation> {
  const rows = await readSettingsIdentity(sql)

  const physical = await observePhysicalIdentity(sql)

  if (rows.length !== 1) {
    return {
      selfReportedWorkspaceId: null,
      stamp: null,
      settingsRowCount: rows.length,
      physical,
      stampSource: 'none',
      stampSourceConflict: null,
      secretCanary: null,
      // `unobserved`, not `absent`: nothing was sampled here, and claiming this
      // database holds nothing would be asserting a fact nobody checked. A
      // database with no single settings row is refused on that ground first, so
      // the key question never arises — but the fail-closed value is still the
      // correct one to carry.
      storedCiphertext: { kind: 'unobserved' },
    }
  }

  const row = rows[0]!
  const fromMetadata = parseStamp(row.metadata)
  const column = normalise(row.cloud_workspace_key)

  let stamp: WorkspaceFingerprintStamp | null = fromMetadata
  let stampSource: StampSource = fromMetadata ? 'metadata' : 'none'
  let conflict: WorkspaceIdentityObservation['stampSourceConflict'] = null

  if (column !== null) {
    if (fromMetadata && fromMetadata.workspaceKey !== column) {
      conflict = { column, metadata: fromMetadata.workspaceKey }
    }
    // The column wins when both agree, and is the only source when the bag has
    // been clobbered. `stampedAt` is not carried on the column: it is
    // informational, and `evaluateFingerprint` does not compare it.
    stamp = { v: 1, workspaceKey: column, stampedAt: fromMetadata?.stampedAt ?? '' }
    stampSource = 'column'
  }

  return {
    selfReportedWorkspaceId: row.id,
    stamp,
    settingsRowCount: 1,
    physical,
    stampSource,
    stampSourceConflict: conflict,
    secretCanary: normalise(row.cloud_secret_canary),
    storedCiphertext: await probeStoredCiphertext(secretKey, row.stored_ciphertext),
  }
}

/**
 * The repair, stated so it is true whichever custody scheme the record names.
 *
 * The old text sent every operator to `establish-workspace-secrets.ts`. That script
 * repairs exactly one kind of workspace. `establishWorkspaceAppSecrets` computes a
 * derived ref unconditionally and only *warns* that it is replacing the one it
 * was handed — so on a workspace whose `appSecretsRef` says `env://` or
 * `openbao+kv://`, following that instruction repoints the record at a third key
 * and stamps a canary under it. The workspace then holds ciphertext from key A, a
 * record naming key C, and a canary certifying C: the mismatch stops being
 * repairable rather than being repaired.
 *
 * An error that tells an operator to do the wrong thing is worse than one that
 * says nothing, so the condition is named rather than assumed.
 */
const CUSTODY_REPAIR_ADVICE =
  `Stamp the canary under the key this workspace's appSecretsRef ALREADY names — do not let a ` +
  `tool pick the key. Re-establishing workspace secrets is a control-plane-side operation, and ` +
  `only for a workspace already on derived+hkdf://: it computes a derived ref and replaces ` +
  `whatever the record named, so running it against an env:// or openbao+kv:// workspace points ` +
  `the record at a THIRD key and stamps a canary under it.\n` +
  `Provisioning will not do it either: it returns early on an already-registered workspace, ` +
  `before the custody step.`

/**
 * Does the key this process resolved match the key this database's ciphertext
 * was written under?
 *
 * A separate verdict from {@link evaluateWorkspaceIdentity} on purpose. That one
 * asks "is this the right database"; this one asks "is this the right key", and
 * conflating them would make the refusal log name the wrong problem — the
 * database can be exactly correct while the key is wrong, and the operator fix
 * for the two is nothing alike.
 *
 * Missing is a refusal, not a pass. That mirrors the stamp rule for the same
 * reason: "no evidence" and "good evidence" must not produce the same outcome
 * when the thing at stake is whether new ciphertext is about to be written under
 * a key that will not open it again.
 *
 * ## Two facts, because the canary alone answers a different question
 *
 * The canary is minted by whoever last took custody. Opening it proves this
 * process holds the key the canary was sealed with, and nothing whatsoever about
 * the data already in the database — so a custody change that re-stamps the
 * canary certifies the new key over ciphertext the new key cannot open. That is
 * not a hypothetical: it is what shipped, and it surfaced as an untyped 500 on
 * every authenticated request rather than as a refusal here.
 *
 * So `storedCiphertext` is a second, independent fact, and the canary is no
 * longer sufficient on its own. It defaults to `unobserved`, which refuses: a
 * caller that rules without gathering evidence gets the same answer as a caller
 * with bad evidence, which is the fail-closed direction and the one the old
 * shape of this function got wrong.
 */
export function evaluateSecretKeyCanary(
  workspaceKey: string,
  secretKey: string,
  observedCanary: string | null,
  storedCiphertext: StoredCiphertextProbe = { kind: 'unobserved' }
): IdentityVerdict {
  if (!observedCanary) {
    return {
      ok: false,
      code: 'secret_key_canary_missing',
      detail:
        `settings.cloud_secret_canary is absent for ${workspaceKey}, so nothing records which key ` +
        `this database's stored ciphertext was written under. Absent is not greenfield: it ` +
        `means no record, and the data is there either way. ` +
        CUSTODY_REPAIR_ADVICE,
    }
  }
  if (!verifySecretKeyCanary(secretKey, workspaceKey, observedCanary)) {
    return {
      ok: false,
      code: 'secret_key_canary_mismatch',
      detail:
        `the SECRET_KEY this process resolved does not open settings.cloud_secret_canary. ` +
        `Serving would write new ciphertext under a key that cannot read the old — refusing. ` +
        `Check the fleet root key, and the scheme and generation in this workspace's ` +
        `appSecretsRef. ` +
        CUSTODY_REPAIR_ADVICE,
    }
  }

  switch (storedCiphertext.kind) {
    case 'unopenable':
      return {
        ok: false,
        code: 'secret_key_stored_ciphertext_mismatch',
        detail:
          `the SECRET_KEY this process resolved opens settings.cloud_secret_canary but does NOT ` +
          `open ${storedCiphertext.source}, which this database was already holding. The canary ` +
          `is newer than the data: custody moved and the canary was re-stamped over a database ` +
          `nobody re-encrypted. Re-stamping again repeats exactly that and makes it permanent. ` +
          `Restore custody of the key the stored ciphertext was written under, or re-encrypt ` +
          `this database under the key now in force and stamp the canary last.`,
      }
    case 'unobserved':
      return {
        ok: false,
        code: 'secret_key_custody_unproven',
        detail:
          `settings.cloud_secret_canary opened, but no ciphertext was sampled from this ` +
          `database to corroborate it. The canary attests possession of the key it was itself ` +
          `sealed with; on its own it says nothing about the key the stored data was written ` +
          `under. This is a caller that ruled without gathering evidence, not a workspace fault.`,
      }
    case 'absent':
      // Nothing sealed under this key exists yet, so there is nothing a wrong
      // key could fail to open and nothing serving can damage that is not
      // already damaged. Saying so out loud rather than letting it fall out of
      // a falsy check: this is the one state where a canary on its own is
      // enough, and it is enough because the risk it guards has no subject.
      return { ok: true }
    case 'opened':
      return { ok: true }
  }
}

/**
 * Catalog identity: `current_database()` and `pg_database.oid`. A dump/restore
 * or `TEMPLATE` clone keeps the content fingerprint and gets a new oid, which
 * is the anti-clone half.
 */
export async function observePhysicalIdentity(sql: Sql): Promise<ObservedPhysicalIdentity> {
  const rows = (await sql`
    SELECT current_database() AS catalog_name,
           (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS catalog_oid
  `) as unknown as Array<{
    catalog_name: string | null
    catalog_oid: string | null
  }>
  const row = rows[0]
  return {
    currentDatabase: normalise(row?.catalog_name ?? null),
    catalogOid: normalise(row?.catalog_oid ?? null),
  }
}

/**
 * The whole verdict, in the order that produces the most useful refusal.
 *
 * Content first (is this a Quackback database, and whose?), placement second
 * (is it the *copy* the registry named?). A wrong-database mix-up should not
 * report as a branch problem.
 */
export function evaluateWorkspaceIdentity(
  expected: WorkspaceFingerprintExpectation,
  physicalExpected: PhysicalExpectation,
  observed: WorkspaceIdentityObservation
): IdentityVerdict {
  const content = evaluateFingerprint(expected, observed)
  if (!content.ok) return content

  if (observed.stampSourceConflict) {
    return {
      ok: false,
      code: 'stamp_source_conflict',
      detail:
        `settings.cloud_workspace_key says ${observed.stampSourceConflict.column} but ` +
        `settings.metadata.${WORKSPACE_FINGERPRINT_METADATA_KEY} says ` +
        `${observed.stampSourceConflict.metadata} — two writers, two owners`,
    }
  }

  return evaluatePhysicalIdentity(physicalExpected, observed.physical)
}

/** Pull the stamp out of the settings metadata bag. Never throws. */
export function parseStamp(metadata: string | null): WorkspaceFingerprintStamp | null {
  if (!metadata) return null
  let bag: unknown
  try {
    bag = JSON.parse(metadata)
  } catch {
    return null
  }
  if (typeof bag !== 'object' || bag === null) return null
  const raw = (bag as Record<string, unknown>)[WORKSPACE_FINGERPRINT_METADATA_KEY]
  if (raw === undefined) return null
  const parsed = workspaceFingerprintStampSchema.safeParse(raw)
  return parsed.success ? (parsed.data as WorkspaceFingerprintStamp) : null
}

function normalise(value: string | null): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}
