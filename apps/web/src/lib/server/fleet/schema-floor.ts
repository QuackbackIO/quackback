/**
 * The `MIN_SCHEMA_VERSION` compatibility gate.
 *
 * ```
 * resolve tenant → assert fingerprint matches → assert schema >= MIN_SCHEMA_VERSION
 *   → else: this workspace is updating (503 for THIS tenant only)
 * ```
 *
 * ## Why a gate is needed at all when migrations are expand-only
 *
 * Because expand-only is not sufficient. Drizzle emits **explicit column
 * lists**, so a build that postdates an additive migration issues
 * `select "id", …, "cloud", … from "settings"` and `findFirst()` *throws*
 * against a database where that column does not exist. A missing value and a
 * missing column are not the same thing, and every additive migration in this
 * repository has that property. Expand must land *before* the code that reads
 * it, and this is what happens when it has not.
 *
 * ## Two properties, and the second is the one people get wrong
 *
 * **A tenant mid-migration degrades alone.** The check runs per tenant, on pool
 * checkout, and produces a refusal for that tenant only. Nothing about it is
 * fleet-wide, which is the difference between one workspace showing "updating"
 * and an outage.
 *
 * **A tenant *ahead* of the code is served normally.** During a rollout the new
 * image migrates a tenant that old replicas are still serving; refusing it there
 * would turn every rollout into an outage on the way *in*. So the floor is a
 * prefix check — every bundled migration up to the floor must be applied — and
 * migrations above it are not consulted. This is the same reason
 * `getMigrationStatus()`'s bundled-⊆-applied semantics are kept deliberately
 * rather than "fixed".
 *
 * With expand/contract discipline the gate **should essentially never fire**. It
 * is a safety net, not the normal path, which is why it is off unless
 * `MIN_SCHEMA_VERSION` is set: a self-hosted install ships code and schema
 * together and has nothing to gate.
 *
 * ## Why it reads the tenant database and not the control plane
 *
 * The control plane's `cp_tenant_schema_state.current_version` is a *belief*,
 * only as fresh as the last reconcile. The tenant's own
 * `drizzle.__drizzle_migrations` is the thing the failing query will actually be
 * issued against. Reading the belief would let a stale control row certify a
 * database that cannot serve — a gate that is switched off while looking
 * switched on. It costs one query per pool, on the same checkout that already
 * pays for the fingerprint.
 */
import type { Sql } from 'postgres'
import {
  evaluateSchemaFloor,
  readAppliedLedger,
  resolveVersionSpec,
  UnknownSchemaVersion,
  type SchemaFloorVerdict,
} from '@quackback/db/schema-version'

/** Distinguishable from a fingerprint refusal, because it means something else. */
export const SCHEMA_FLOOR_REFUSAL_CODE = 'schema_below_floor'

/**
 * A `MIN_SCHEMA_VERSION` this build cannot resolve. Distinct from both of the
 * above: the tenant is fine, the process is not.
 */
export const SCHEMA_FLOOR_MISCONFIGURED_CODE = 'schema_floor_misconfigured'

export class TenantSchemaFloorRefusal extends Error {
  readonly code = SCHEMA_FLOOR_REFUSAL_CODE
  readonly tenantId: string
  readonly missing: string[]
  readonly floorTag: string

  constructor(tenantId: string, verdict: SchemaFloorVerdict) {
    super(
      `REFUSED [${SCHEMA_FLOOR_REFUSAL_CODE}] this database is below MIN_SCHEMA_VERSION ` +
        `${verdict.floorTag}; missing ${verdict.missing.length} migration(s): ` +
        `${verdict.missing.slice(0, 5).join(', ')}${verdict.missing.length > 5 ? ', …' : ''}. ` +
        'This build issues explicit column lists that the schema cannot satisfy, so serving it ' +
        'would throw on ordinary reads. Migrate this tenant before serving it here.'
    )
    this.name = 'TenantSchemaFloorRefusal'
    this.tenantId = tenantId
    this.missing = verdict.missing
    this.floorTag = verdict.floorTag
  }
}

let floorMemo: { raw: string | undefined; value: number | null } | null = null

/**
 * The configured floor, or null when the gate is off.
 *
 * Read from `process.env` directly rather than through the zod config, matching
 * `process-role.ts` and `tenancy/mode.ts`: this runs on the pool-checkout path,
 * and making it validate the whole application configuration would turn an
 * unrelated missing variable into a database error.
 *
 * A value that names no bundled migration **throws**. That is deliberate and it
 * is the only failure direction available: silently treating a typo as "no
 * floor" produces a gate that is off while every dashboard says it is on.
 */
export function configuredSchemaFloor(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.MIN_SCHEMA_VERSION
  if (floorMemo && floorMemo.raw === raw) return floorMemo.value
  const value = raw === undefined || raw.trim() === '' ? null : resolveVersionSpec(raw)
  floorMemo = { raw, value }
  return value
}

/** Test seam. The memo is keyed on the raw value, but tests mutate env in place. */
export function __resetSchemaFloorMemo(): void {
  floorMemo = null
}

/**
 * Resolve the floor once, at boot, so a typo is a refusal to start rather than
 * a fleet-wide outage discovered by customers.
 *
 * `configuredSchemaFloor` is otherwise read lazily on pool checkout, and that
 * placement has a nasty property: an unresolvable value throws *per tenant*,
 * inside the acquisition path, where it is indistinguishable from the tenant's
 * own database failing. Measured before this existed: `MIN_SCHEMA_VERSION=9999`
 * 503'd **every tenant including healthy ones**, logged the cross-tenant
 * fingerprint alarm, and left the readiness probe green.
 *
 * Called from `startup.ts` and from the readiness probe. The probe deliberately
 * asserts nothing about *tenant* schemas under pooled tenancy — but
 * this is not a tenant schema, it is this process's own configuration, and a
 * process that cannot resolve its own serving floor is not ready.
 */
export function assertSchemaFloorConfigured(env: NodeJS.ProcessEnv = process.env): void {
  configuredSchemaFloor(env)
}

export { UnknownSchemaVersion }

/**
 * Assert a tenant database meets the floor. No-op when the gate is off.
 *
 * Throws {@link TenantSchemaFloorRefusal} rather than returning a verdict,
 * because the one caller is the pool-cache verification promise and its
 * contract is "resolve or refuse".
 */
export async function assertSchemaFloor(tenantId: string, sql: Sql): Promise<void> {
  const floor = configuredSchemaFloor()
  if (floor === null) return
  const applied = await readAppliedLedger(sql)
  const verdict = evaluateSchemaFloor(applied, floor)
  if (!verdict.ok) throw new TenantSchemaFloorRefusal(tenantId, verdict)
}
