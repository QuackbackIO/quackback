/**
 * Reading the tenant registry — the app side of `quackback-cp`'s
 * `docs/tenant-registry-contract.md`.
 *
 * The control plane owns two tables in its own Postgres:
 * `cp_tenant_hostnames` (hostname → tenant, hostname is the primary key, so
 * fleet-wide uniqueness is structural) and `cp_tenant_registry` (one row per
 * tenant, carrying everything needed to serve it). This module turns a Host
 * header into one of five outcomes, and only one of them carries a DSN.
 *
 * Three things are deliberate.
 *
 * **One query, not two.** A separate hostname lookup would open a window in
 * which the record and its hostnames disagree, and this runs on every cache
 * miss on the request path.
 *
 * **Validation is the vendored contract, not a local reading.** `validateTenantRecord`
 * comes from `vendor/contract.ts`, copied byte-for-byte from the control plane
 * so the two repos cannot drift into two readings of the same record. A reader
 * that trusts the writer is one migration away from serving the wrong tenant.
 *
 * **`neon_project_id` / `neon_branch_id` are read here even though contract v1
 * does not carry them in `TenantRecord`.** They are real columns on
 * `cp_tenant_registry`, and they are the only defence against a database
 * *branch* — see `physical-identity.ts`. They are attached alongside the
 * validated record rather than smuggled into it, so the vendored schema stays
 * byte-identical to the control plane's.
 */
import postgres from 'postgres'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import type { PhysicalExpectation } from './physical-identity'
import { validateTenantRecord, type TenantRecord, type TenantResolution } from './vendor/contract'

const log = logger.child({ component: 'tenant-registry' })

/**
 * A validated record plus the physical placement the contract does not model.
 *
 * Structurally a `TenantRecord`, so everything typed against the contract keeps
 * working; `physical` is additive.
 */
export interface TenantDescriptor extends TenantRecord {
  readonly physical: PhysicalExpectation
}

export type TenantLookup =
  | { kind: 'ok'; tenant: TenantDescriptor }
  | Exclude<TenantResolution, { kind: 'ok' }>

interface RegistryRow {
  tenant_id: string
  contract_version: number
  state: string
  state_reason: string | null
  primary_hostname: string
  base_url: string
  db_pooled_url: string
  db_direct_url: string
  db_name: string
  db_role: string
  db_credential_ref: string
  app_secrets_ref: string
  workspace_id: string
  fingerprint_stamped_at: Date | string
  storage: unknown
  email_from: string
  ai_enabled: boolean
  revision: string | number
  neon_project_id: string | null
  neon_branch_id: string | null
  hostnames: string[]
}

let controlSql: postgres.Sql | null = null

/**
 * How long the control socket survives with nothing to do.
 *
 * Derived from the registry cache TTL rather than picked, and it has to be
 * *above* it. A read happens on a cache miss, so on a fleet with any traffic at
 * all the misses arrive one TTL apart; a shorter idle timeout would tear the
 * socket down and rebuild it between every pair of them, putting a connect on
 * the request path for no saving. Above the TTL, a fleet that is being used
 * keeps one warm socket, and a fleet that has genuinely stopped drops it.
 *
 * The 15s margin is slack for a miss that arrives a little late — a TTL that
 * expires at 30s is not read again at exactly 30s.
 */
function controlIdleSeconds(): number {
  return Math.ceil(config.tenantRegistryTtlMs / 1000) + 15
}

/**
 * Observability for the control connection, without connecting to get it.
 *
 * The readiness probe used to answer "is the control database reachable?" by
 * running `SELECT 1` on every poll, and a probe that runs every few seconds is a
 * client that is always connected — which is the whole reason this database
 * never suspended. So the last real read is recorded here and readiness reads
 * *that*. See `health.ready.ts` for what it does when there has been no read.
 */
interface ControlReadState {
  lastOkAt: number
  lastErrorAt: number
  lastError: string | null
}
const controlRead: ControlReadState = { lastOkAt: 0, lastErrorAt: 0, lastError: null }

export function getControlReadState(): Readonly<ControlReadState> {
  return controlRead
}

/**
 * Connect and ask the control database whether it is there.
 *
 * The fallback for the readiness probe when observation has nothing recent to
 * report. Recorded like a real read, so a probe that succeeds after a failure
 * clears the failure instead of leaving the fleet permanently probing.
 */
export async function probeControlDatabase(): Promise<void> {
  await recordControlRead(getControlSql()`SELECT 1`)
}

function recordControlRead<T>(promise: Promise<T>): Promise<T> {
  return promise.then(
    (value) => {
      controlRead.lastOkAt = Date.now()
      controlRead.lastError = null
      return value
    },
    (err: unknown) => {
      controlRead.lastErrorAt = Date.now()
      controlRead.lastError = err instanceof Error ? err.message : String(err)
      throw err
    }
  )
}

/**
 * The control-plane connection.
 *
 * Tiny and shared: one read path for the whole instance, the only database a
 * pooled process may touch without a tenant scope, and never to be confused with
 * a tenant pool.
 *
 * ## It releases between reads, and that is a decision with a cost
 *
 * This connection used to be held open on the grounds that a control database is
 * always warm anyway. Measured, "always warm" meant **95% active for 23 hours**
 * — a compute billed continuously so that a cache miss could save a connect. It
 * is not exempt from the cost model just because it is not per tenant, so
 * `idle_timeout` now lets the socket go and the compute suspend.
 *
 * The cost, stated rather than discovered: the registry read happens on a cache
 * miss *before* the tenant connection is opened, so the first request to a
 * fleet that has been idle long enough for both computes to suspend pays a
 * control wake and then a tenant wake, **in series**. Two cold starts, not one.
 *
 * What keeps that off the common path is that the control database is shared.
 * Every hostname's miss lands on it, so it stays warm while *any* tenant in the
 * fleet is being served; it can only suspend after the entire fleet has been
 * silent. The serial double wake is therefore the first request to the whole
 * fleet after fleet-wide idleness, which is the one moment nobody is waiting.
 * The `Sql` object itself is kept — `postgres.js` holds no socket while idle, so
 * the singleton is a handle rather than a connection, and dropping it would only
 * mean rebuilding the pool object.
 */
export function getControlSql(): postgres.Sql {
  if (controlSql) return controlSql
  const url = config.controlDatabaseUrl
  if (!url) {
    throw new Error('QUACKBACK_CONTROL_DATABASE_URL is not set; the tenant registry cannot be read')
  }
  controlSql = postgres(url, {
    max: 2,
    idle_timeout: controlIdleSeconds(),
    connect_timeout: 10,
    onnotice: () => {},
  })
  return controlSql
}

export async function closeControlSql(): Promise<void> {
  const sql = controlSql
  controlSql = null
  if (sql) await sql.end({ timeout: 5 }).catch(() => {})
}

/** Test seam. Swaps the control connection without touching config. */
export function __setControlSqlForTests(sql: postgres.Sql | null): void {
  controlSql = sql
  controlRead.lastOkAt = 0
  controlRead.lastErrorAt = 0
  controlRead.lastError = null
}

const SELECT_COLUMNS = `
  r.tenant_id, r.contract_version, r.state::text AS state, r.state_reason,
  r.primary_hostname, r.base_url,
  r.db_pooled_url, r.db_direct_url, r.db_name, r.db_role, r.db_credential_ref,
  r.app_secrets_ref,
  r.workspace_id, r.fingerprint_stamped_at,
  r.storage, r.email_from, r.ai_enabled, r.revision,
  r.neon_project_id, r.neon_branch_id,
  COALESCE(
    (SELECT array_agg(h2.hostname ORDER BY h2.hostname)
       FROM cp_tenant_hostnames h2
      WHERE h2.tenant_id = r.tenant_id),
    ARRAY[]::text[]
  ) AS hostnames
`

/**
 * `example.com`, `Example.com:443` and `example.com.` all resolve to the same
 * registry key. Anything with a path, credentials, brackets (an IPv6 literal)
 * or a wildcard is not a tenant hostname and returns null rather than being
 * coerced into one.
 *
 * Same rule as the control plane's `normalizeHostHeader`; a port-bearing or
 * trailing-dot Host that failed to normalise would read as `unknown_host` and
 * 404 an entire tenant.
 */
export function normalizeHostHeader(hostHeader: string | null | undefined): string | null {
  if (typeof hostHeader !== 'string') return null
  let host = hostHeader.trim().toLowerCase()
  if (host === '') return null
  if (host.includes('/') || host.includes('@') || host.includes('[') || host.includes('*')) {
    return null
  }
  const colon = host.indexOf(':')
  if (colon >= 0) host = host.slice(0, colon)
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (host === '') return null
  return host
}

export async function resolveTenantByHostname(
  hostHeader: string,
  sql: postgres.Sql = getControlSql()
): Promise<TenantLookup> {
  const hostname = normalizeHostHeader(hostHeader)
  if (hostname === null) return { kind: 'unknown_host', hostname: String(hostHeader) }

  const rows = (await recordControlRead(
    sql.unsafe(
      `SELECT ${SELECT_COLUMNS}
       FROM cp_tenant_hostnames h
       JOIN cp_tenant_registry r ON r.tenant_id = h.tenant_id
      WHERE h.hostname = $1
      LIMIT 1`,
      [hostname]
    )
  )) as unknown as RegistryRow[]

  const row = rows[0]
  if (!row) return { kind: 'unknown_host', hostname }
  return interpretRow(row, hostname)
}

/**
 * Same contract, same refusals, keyed by tenant id — for background subsystems
 * that hold a tenant id rather than a Host header. The union is deliberately
 * the one the request path returns, so a sweeper cannot reach a DSN by a route
 * the request path forbids.
 */
export async function resolveTenantById(
  tenantId: string,
  sql: postgres.Sql = getControlSql()
): Promise<TenantLookup> {
  const rows = (await recordControlRead(
    sql.unsafe(
      `SELECT ${SELECT_COLUMNS} FROM cp_tenant_registry r WHERE r.tenant_id = $1 LIMIT 1`,
      [tenantId]
    )
  )) as unknown as RegistryRow[]

  const row = rows[0]
  if (!row) return { kind: 'unknown_host', hostname: '' }
  return interpretRow(row, row.primary_hostname)
}

/**
 * Every active tenant, for fleet-wide passes (sweeps, migration cohorts).
 *
 * Refused records are logged and dropped rather than returned, so a caller
 * iterating the fleet cannot act on a record the request path would refuse.
 */
export async function listActiveTenants(
  sql: postgres.Sql = getControlSql()
): Promise<{
  tenants: TenantDescriptor[]
  refused: Array<{ tenantId: string; problems: string[] }>
}> {
  const rows = (await recordControlRead(
    sql.unsafe(
      `SELECT ${SELECT_COLUMNS} FROM cp_tenant_registry r WHERE r.state = 'active' ORDER BY r.tenant_id`
    )
  )) as unknown as RegistryRow[]

  const tenants: TenantDescriptor[] = []
  const refused: Array<{ tenantId: string; problems: string[] }> = []
  for (const row of rows) {
    const lookup = interpretRow(row, row.primary_hostname)
    if (lookup.kind === 'ok') tenants.push(lookup.tenant)
    else if (lookup.kind === 'invalid') {
      refused.push({ tenantId: row.tenant_id, problems: lookup.problems })
    }
  }
  return { tenants, refused }
}

/**
 * State gate first, validation second — the control plane's own ordering.
 * A suspended tenant should report as suspended even if its record has some
 * unrelated defect, or suspending a stale tenant reads to the operator as
 * corruption.
 */
export function interpretRow(row: RegistryRow, hostname: string): TenantLookup {
  if (row.state === 'suspended') {
    return {
      kind: 'suspended',
      tenantId: row.tenant_id,
      hostname,
      reason: row.state_reason ?? 'suspended',
    }
  }
  if (row.state === 'deleting') {
    return { kind: 'deleting', tenantId: row.tenant_id, hostname }
  }
  if (row.state !== 'active') {
    return {
      kind: 'invalid',
      tenantId: row.tenant_id,
      hostname,
      problems: [`unknown state '${row.state}'`],
    }
  }

  const result = validateTenantRecord(toRecord(row))
  if (!result.ok) {
    log.error(
      { tenantId: row.tenant_id, hostname, problems: result.problems },
      'tenant registry record refused'
    )
    return { kind: 'invalid', tenantId: row.tenant_id, hostname, problems: result.problems }
  }

  return {
    kind: 'ok',
    tenant: {
      ...result.record,
      physical: {
        neonProjectId: emptyToNull(row.neon_project_id),
        neonBranchId: emptyToNull(row.neon_branch_id),
      },
    },
  }
}

function emptyToNull(value: string | null): string | null {
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Row → contract shape. No defaults and no coalescing: a NULL that reaches here
 * becomes a validation failure rather than a plausible substitute. Filling a
 * gap with a default is exactly how a half-written record becomes a servable one.
 */
function toRecord(row: RegistryRow): unknown {
  return {
    contractVersion: Number(row.contract_version),
    tenantId: row.tenant_id,
    revision: Number(row.revision),
    routing: {
      primaryHostname: row.primary_hostname,
      hostnames: row.hostnames ?? [],
      baseUrl: row.base_url,
    },
    database: {
      pooledUrl: row.db_pooled_url,
      directUrl: row.db_direct_url,
      name: row.db_name,
      role: row.db_role,
      credentialRef: row.db_credential_ref,
    },
    fingerprint: {
      expectedTenantId: row.tenant_id,
      expectedWorkspaceId: row.workspace_id,
      stampedAt:
        row.fingerprint_stamped_at instanceof Date
          ? row.fingerprint_stamped_at.toISOString()
          : String(row.fingerprint_stamped_at ?? ''),
    },
    secrets: { appSecretsRef: row.app_secrets_ref },
    storage: typeof row.storage === 'string' ? safeJson(row.storage) : row.storage,
    email: { from: row.email_from },
    features: { aiEnabled: row.ai_enabled },
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
