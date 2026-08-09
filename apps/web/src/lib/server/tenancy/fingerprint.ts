/**
 * Asking a tenant database who it belongs to, and deciding whether to believe it.
 *
 * SAAS-HOSTING-STACK.md §3, stated plainly: if tenant resolution returns the
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
 * | `neon.branch_id` (GUC) | the platform, per compute | nothing we can reach |
 *
 * The verdict for the first two is `evaluateFingerprint`, vendored byte-for-byte
 * from the control plane so both sides run the same predicate rather than two
 * prose readings of it. The third is `evaluatePhysicalIdentity`, which exists
 * because branching copies data and therefore copies both of the first two.
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
import {
  evaluatePhysicalIdentity,
  type ObservedPhysicalIdentity,
  type PhysicalExpectation,
  type PhysicalFailure,
} from './physical-identity'
import { verifySecretKeyCanary } from './vendor/fleet-secrets'

/** Where the tenant id was read from, for the refusal log. */
export type StampSource = 'column' | 'metadata' | 'none'

export interface TenantIdentityObservation extends ObservedFingerprint {
  physical: ObservedPhysicalIdentity
  stampSource: StampSource
  /** Both sources present and naming different tenants. */
  stampSourceConflict: { column: string; metadata: string } | null
  /**
   * `settings.cloud_secret_canary` — a constant sealed under this tenant's own
   * `SECRET_KEY`. Null on a self-hosted install and on a database that predates
   * migration 0252.
   */
  secretCanary: string | null
}

export type IdentityFailure =
  | FingerprintFailure
  | PhysicalFailure
  | 'stamp_source_conflict'
  | 'secret_key_canary_missing'
  | 'secret_key_canary_mismatch'

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

/**
 * Read what a tenant database says about itself. Observations only, never a
 * verdict — the verdict lives in exactly one place.
 */
export async function observeTenantIdentity(sql: Sql): Promise<TenantIdentityObservation> {
  // LIMIT 2 rather than count(*): one round trip, and it distinguishes 0, 1 and
  // "more than one", which is all the verdict needs.
  const rows = (await sql`
    SELECT s.id::text AS id,
           s.metadata,
           (to_jsonb(s) ->> 'cloud_tenant_id')     AS cloud_tenant_id,
           (to_jsonb(s) ->> 'cloud_secret_canary') AS cloud_secret_canary
      FROM settings s
     LIMIT 2
  `) as unknown as Array<{
    id: string
    metadata: string | null
    cloud_tenant_id: string | null
    cloud_secret_canary: string | null
  }>

  const physical = await observePhysicalIdentity(sql)

  if (rows.length !== 1) {
    return {
      workspaceId: null,
      stamp: null,
      settingsRowCount: rows.length,
      physical,
      stampSource: 'none',
      stampSourceConflict: null,
      secretCanary: null,
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
    physical,
    stampSource,
    stampSourceConflict: conflict,
    secretCanary: normalise(row.cloud_secret_canary),
  }
}

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
 */
export function evaluateSecretKeyCanary(
  tenantId: string,
  secretKey: string,
  observedCanary: string | null
): IdentityVerdict {
  if (!observedCanary) {
    return {
      ok: false,
      code: 'secret_key_canary_missing',
      detail:
        `settings.cloud_secret_canary is absent, so nothing proves this fleet holds the key ` +
        `this database's stored ciphertext was written under. Repair with the control plane's ` +
        `establish-tenant-secrets script:\n` +
        `  bun run src/scripts/establish-tenant-secrets.ts --tenant-id ${tenantId}\n` +
        `Provisioning will NOT do it: it returns early on an already-registered tenant, before ` +
        `the custody step.`,
    }
  }
  if (!verifySecretKeyCanary(secretKey, tenantId, observedCanary)) {
    return {
      ok: false,
      code: 'secret_key_canary_mismatch',
      detail:
        `the SECRET_KEY this process resolved does not open settings.cloud_secret_canary. ` +
        `Serving would write new ciphertext under a key that cannot read the old — refusing. ` +
        `Check the fleet root key and the generation in this tenant's appSecretsRef.`,
    }
  }
  return { ok: true }
}

/**
 * Neon's own identity GUCs. Verified present through both the direct and the
 * pooled endpoint. `current_setting(name, true)` yields NULL instead of raising
 * on a plain Postgres, which is what a self-hosted tenant looks like.
 */
export async function observePhysicalIdentity(sql: Sql): Promise<ObservedPhysicalIdentity> {
  const rows = (await sql`
    SELECT current_setting('neon.project_id', true)  AS project_id,
           current_setting('neon.branch_id', true)   AS branch_id,
           current_setting('neon.endpoint_id', true) AS endpoint_id
  `) as unknown as Array<{
    project_id: string | null
    branch_id: string | null
    endpoint_id: string | null
  }>
  const row = rows[0]
  return {
    neonProjectId: normalise(row?.project_id ?? null),
    neonBranchId: normalise(row?.branch_id ?? null),
    neonEndpointId: normalise(row?.endpoint_id ?? null),
  }
}

/**
 * The whole verdict, in the order that produces the most useful refusal.
 *
 * Content first (is this a Quackback database, and whose?), placement second
 * (is it the *copy* the registry named?). A wrong-database mix-up should not
 * report as a branch problem.
 */
export function evaluateTenantIdentity(
  expected: TenantFingerprintExpectation,
  physicalExpected: PhysicalExpectation,
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

  return evaluatePhysicalIdentity(physicalExpected, observed.physical)
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
