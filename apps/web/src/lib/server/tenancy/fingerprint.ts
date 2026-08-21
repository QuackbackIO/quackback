/**
 * Asking a tenant database who it belongs to, and deciding whether to believe it.
 *
 * Stated plainly: if tenant resolution returns the
 * wrong pool, every RBAC and permission check still passes, because that
 * database's own `settings`, `principal` and `roles` rows are entirely
 * self-consistent. It does not error. It looks correct. There is no second gate,
 * so this is the gate.
 *
 * Two independent facts are checked, and each covers a hole in the other:
 *
 * | Fact | Written by | Beaten by |
 * | --- | --- | --- |
 * | `settings.id` | nobody — it is a primary key | a copy of the database |
 * | the control plane's stamp | the CP, deliberately | a copy of the database |
 *
 * The verdict is `evaluateFingerprint`, vendored byte-for-byte from the control
 * plane so both sides run the same predicate rather than two prose readings of
 * it. A deliberately restored copy of a tenant database carries both facts and
 * passes; that is an operator action, and repointing a record at a restore is
 * the operator's call to make.
 *
 * ## Where the stamp is read from
 *
 * Preferentially from `settings.cloud_tenant_id`, a dedicated column
 * (migration 0251). The stamp's original home is the `settings.metadata` JSON
 * bag, and `telemetry/instance-id.ts` performs an unlocked, unattended **hourly**
 * read-modify-write of that same bag which never invalidates the settings cache —
 * so it can interleave with a stamp write and drop it. A column removes the whole
 * class rather than narrowing the window.
 *
 * The column is read through `to_jsonb(s) ->> 'cloud_tenant_id'` rather than by
 * name, so this query still runs against a database that predates 0251 and
 * simply reports the column as absent. That matters because the fingerprint is
 * the *first* thing a pooled process does with a tenant database — refusing to
 * even look because of an ordering problem would turn an expand-only migration
 * into an outage.
 *
 * When both sources are present and disagree, that is a refusal in its own
 * right: two writers claiming different owners is not a state to pick a winner
 * from.
 */
import type { Sql } from 'postgres'
import {
  TENANT_FINGERPRINT_METADATA_KEY,
  evaluateFingerprint,
  tenantFingerprintStampSchema,
  type FingerprintFailure,
  type ObservedFingerprint,
  type TenantFingerprintExpectation,
  type TenantFingerprintStamp,
} from './vendor/contract'
import { verifySecretKeyCanary } from './vendor/fleet-secrets'
import { probeStoredCiphertext, type StoredCiphertextProbe } from './stored-ciphertext'

/** Where the tenant id was read from, for the refusal log. */
export type StampSource = 'column' | 'metadata' | 'none'

export interface TenantIdentityObservation extends ObservedFingerprint {
  stampSource: StampSource
  /** Both sources present and naming different tenants. */
  stampSourceConflict: { column: string; metadata: string } | null
  /**
   * `settings.cloud_secret_canary` — a constant sealed under this tenant's own
   * `SECRET_KEY`. Null on a self-hosted install and on a database that predates
   * migration 0252.
   */
  secretCanary: string | null
  /**
   * The same key, tried against ciphertext this database was already holding.
   *
   * The canary is minted by whoever last took custody, so it attests only that
   * this process holds the key the canary was sealed with. This is the fact it
   * cannot supply: whether that key is the one the tenant's *stored* data was
   * written under. See `stored-ciphertext.ts` for which value is sampled.
   */
  storedCiphertext: StoredCiphertextProbe
}

export type IdentityFailure =
  | FingerprintFailure
  | 'stamp_source_conflict'
  | 'secret_key_canary_missing'
  | 'secret_key_canary_mismatch'
  | 'secret_key_stored_ciphertext_mismatch'
  | 'secret_key_custody_unproven'

/**
 * Two subjects run through these codes, and the refusal details keep them
 * apart on purpose: the `settings_*`/`stamp_*`/`workspace_*` codes mean the
 * row in front of us belongs to someone else, while the `secret_key_*` codes
 * mean the row may be exactly right and the key we would encrypt under is not
 * the one its stored ciphertext was written with. The operator fix for the two
 * is nothing alike, so a message must never report one as the other.
 */

/**
 * The second question about a refusal: can retrying ever fix it?
 *
 * A separate axis from the subject above, and it has to be, because the two do
 * not correlate. The subject decides which alarm an operator reads; this decides
 * whether the fleet should keep asking. Measured consequence of not having it:
 * a tenant refused for a configuration reason was reconnected **once per
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
  stamp_tenant_mismatch: 'terminal',
  workspace_id_mismatch: 'terminal',
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
 * backoff, while an unknown code wrongly called terminal costs a tenant its
 * service until an operator notices.
 */
export function isTerminalRefusalCode(code: string): boolean {
  return IDENTITY_FAILURE_RETRYABILITY[code as IdentityFailure] === 'terminal'
}

export type IdentityVerdict = { ok: true } | { ok: false; code: IdentityFailure; detail: string }

/** Thrown by the pool cache when a tenant database fails its own fingerprint. */
export class TenantFingerprintRefusal extends Error {
  readonly code: IdentityFailure
  readonly tenantId: string
  constructor(tenantId: string, code: IdentityFailure, detail: string) {
    super(`REFUSED [${code}] ${detail}`)
    this.name = 'TenantFingerprintRefusal'
    this.code = code
    this.tenantId = tenantId
  }
}

interface SettingsIdentityRow {
  id: string
  metadata: string | null
  cloud_tenant_id: string | null
  cloud_secret_canary: string | null
  stored_ciphertext: string | null
}

/**
 * The settings read, with a sample of the tenant's own ciphertext riding along.
 *
 * The sample is a correlated subquery in the *same statement*, so the evidence
 * the key check needs costs no extra round trip on the checkout path.
 *
 * `jwks` is created by migration 0001, one step behind `settings` itself, so a
 * database that has this query's `FROM` but not its subquery is one that never
 * finished provisioning. That is still not a reason to hard-fail: this is the
 * first thing a pooled process does with a tenant database, and refusing to even
 * look because a table arrived a migration later is how an ordering problem
 * becomes an outage. So the one error that means exactly that — `42P01`,
 * undefined table — falls back to the settings-only read, and the tenant is
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
             (to_jsonb(s) ->> 'cloud_tenant_id')     AS cloud_tenant_id,
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
             (to_jsonb(s) ->> 'cloud_tenant_id')     AS cloud_tenant_id,
             (to_jsonb(s) ->> 'cloud_secret_canary') AS cloud_secret_canary
        FROM settings s
       LIMIT 2
    `) as unknown as Omit<SettingsIdentityRow, 'stored_ciphertext'>[]
    return rows.map((row) => ({ ...row, stored_ciphertext: null }))
  }
}

/**
 * Read what a tenant database says about itself. Observations only, never a
 * verdict — the verdict lives in exactly one place.
 *
 * `secretKey` is the key this process resolved for the tenant and is about to
 * put into service. It is taken here rather than at the verdict because opening
 * a sample is I/O-shaped and the verdict is a pure function; what crosses the
 * boundary is which of four things happened, never the plaintext.
 */
export async function observeTenantIdentity(
  sql: Sql,
  secretKey: string
): Promise<TenantIdentityObservation> {
  const rows = await readSettingsIdentity(sql)

  if (rows.length !== 1) {
    return {
      workspaceId: null,
      stamp: null,
      settingsRowCount: rows.length,
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
  const column = normalise(row.cloud_tenant_id)

  let stamp: TenantFingerprintStamp | null = fromMetadata
  let stampSource: StampSource = fromMetadata ? 'metadata' : 'none'
  let conflict: TenantIdentityObservation['stampSourceConflict'] = null

  if (column !== null) {
    if (fromMetadata && fromMetadata.tenantId !== column) {
      conflict = { column, metadata: fromMetadata.tenantId }
    }
    // The column wins when both agree, and is the only source when the bag has
    // been clobbered. `stampedAt` is not carried on the column: it is
    // informational, and `evaluateFingerprint` does not compare it.
    stamp = { v: 1, tenantId: column, stampedAt: fromMetadata?.stampedAt ?? '' }
    stampSource = 'column'
  }

  return {
    workspaceId: row.id,
    stamp,
    settingsRowCount: 1,
    stampSource,
    stampSourceConflict: conflict,
    secretCanary: normalise(row.cloud_secret_canary),
    storedCiphertext: await probeStoredCiphertext(secretKey, row.stored_ciphertext),
  }
}

/**
 * The repair, stated so it is true whichever custody scheme the record names.
 *
 * The old text sent every operator to `establish-tenant-secrets.ts`. That script
 * repairs exactly one kind of tenant. `establishTenantAppSecrets` computes a
 * derived ref unconditionally and only *warns* that it is replacing the one it
 * was handed — so on a tenant whose `appSecretsRef` says `env://` or
 * `openbao+kv://`, following that instruction repoints the record at a third key
 * and stamps a canary under it. The tenant then holds ciphertext from key A, a
 * record naming key C, and a canary certifying C: the mismatch stops being
 * repairable rather than being repaired.
 *
 * An error that tells an operator to do the wrong thing is worse than one that
 * says nothing, so the condition is named rather than assumed.
 */
const CUSTODY_REPAIR_ADVICE =
  `Stamp the canary under the key this tenant's appSecretsRef ALREADY names — do not let a ` +
  `tool pick the key. The control plane's establish-tenant-secrets script is only that tool ` +
  `for a tenant already on derived+hkdf://: it computes a derived ref and replaces whatever ` +
  `the record named, so running it against an env:// or openbao+kv:// tenant points the ` +
  `record at a THIRD key and stamps a canary under it.\n` +
  `  bun run src/scripts/establish-tenant-secrets.ts --tenant-id <id>   # derived+hkdf:// only\n` +
  `Provisioning will not do it either: it returns early on an already-registered tenant, ` +
  `before the custody step.`

/**
 * Does the key this process resolved match the key this database's ciphertext
 * was written under?
 *
 * A separate verdict from {@link evaluateTenantIdentity} on purpose. That one
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
  tenantId: string,
  secretKey: string,
  observedCanary: string | null,
  storedCiphertext: StoredCiphertextProbe = { kind: 'unobserved' }
): IdentityVerdict {
  if (!observedCanary) {
    return {
      ok: false,
      code: 'secret_key_canary_missing',
      detail:
        `settings.cloud_secret_canary is absent for ${tenantId}, so nothing records which key ` +
        `this database's stored ciphertext was written under. Absent is not greenfield: it ` +
        `means no record, and the data is there either way. ` +
        CUSTODY_REPAIR_ADVICE,
    }
  }
  if (!verifySecretKeyCanary(secretKey, tenantId, observedCanary)) {
    return {
      ok: false,
      code: 'secret_key_canary_mismatch',
      detail:
        `the SECRET_KEY this process resolved does not open settings.cloud_secret_canary. ` +
        `Serving would write new ciphertext under a key that cannot read the old — refusing. ` +
        `Check the fleet root key, and the scheme and generation in this tenant's ` +
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
          `under. This is a caller that ruled without gathering evidence, not a tenant fault.`,
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

/** The whole verdict, in the order that produces the most useful refusal. */
export function evaluateTenantIdentity(
  expected: TenantFingerprintExpectation,
  observed: TenantIdentityObservation
): IdentityVerdict {
  const content = evaluateFingerprint(expected, observed)
  if (!content.ok) return content

  if (observed.stampSourceConflict) {
    return {
      ok: false,
      code: 'stamp_source_conflict',
      detail:
        `settings.cloud_tenant_id says ${observed.stampSourceConflict.column} but ` +
        `settings.metadata.${TENANT_FINGERPRINT_METADATA_KEY} says ` +
        `${observed.stampSourceConflict.metadata} — two writers, two owners`,
    }
  }

  return { ok: true }
}

/** Pull the stamp out of the settings metadata bag. Never throws. */
export function parseStamp(metadata: string | null): TenantFingerprintStamp | null {
  if (!metadata) return null
  let bag: unknown
  try {
    bag = JSON.parse(metadata)
  } catch {
    return null
  }
  if (typeof bag !== 'object' || bag === null) return null
  const raw = (bag as Record<string, unknown>)[TENANT_FINGERPRINT_METADATA_KEY]
  if (raw === undefined) return null
  const parsed = tenantFingerprintStampSchema.safeParse(raw)
  return parsed.success ? (parsed.data as TenantFingerprintStamp) : null
}

function normalise(value: string | null): string | null {
  if (value === null || value === undefined) return null
  const trimmed = String(value).trim()
  return trimmed === '' ? null : trimmed
}
