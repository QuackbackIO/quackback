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
 */
import postgres from 'postgres'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { validateTenantRecord, type TenantRecord, type TenantResolution } from './vendor/contract'

const log = logger.child({ component: 'tenant-registry' })

/** A validated registry record. The alias names the app-side reading of it. */
export type TenantDescriptor = TenantRecord

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
  hostnames: string[]
}

let controlSql: postgres.Sql | null = null

/**
 * The control-plane connection.
 *
 * Tiny and shared: one read path for the whole instance, the only database a
 * pooled process may touch without a tenant scope, and never to be confused with
 * a tenant pool.
 */
export function getControlSql(): postgres.Sql {
  if (controlSql) return controlSql
  const url = config.controlDatabaseUrl
  if (!url) {
    throw new Error('QUACKBACK_CONTROL_DATABASE_URL is not set; the tenant registry cannot be read')
  }
  controlSql = postgres(url, {
    max: 2,
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
}

const SELECT_COLUMNS = `
  r.tenant_id, r.contract_version, r.state::text AS state, r.state_reason,
  r.primary_hostname, r.base_url,
  r.db_pooled_url, r.db_direct_url, r.db_name, r.db_role, r.db_credential_ref,
  r.app_secrets_ref,
  r.workspace_id, r.fingerprint_stamped_at,
  r.storage, r.email_from, r.ai_enabled, r.revision,
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

  const rows = (await sql.unsafe(
    `SELECT ${SELECT_COLUMNS}
       FROM cp_tenant_hostnames h
       JOIN cp_tenant_registry r ON r.tenant_id = h.tenant_id
      WHERE h.hostname = $1
      LIMIT 1`,
    [hostname]
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
  const rows = (await sql.unsafe(
    `SELECT ${SELECT_COLUMNS} FROM cp_tenant_registry r WHERE r.tenant_id = $1 LIMIT 1`,
    [tenantId]
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
export async function listActiveTenants(sql: postgres.Sql = getControlSql()): Promise<{
  tenants: TenantDescriptor[]
  refused: Array<{ tenantId: string; problems: string[] }>
}> {
  const rows = (await sql.unsafe(
    `SELECT ${SELECT_COLUMNS} FROM cp_tenant_registry r WHERE r.state = 'active' ORDER BY r.tenant_id`
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

  return { kind: 'ok', tenant: result.record }
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
