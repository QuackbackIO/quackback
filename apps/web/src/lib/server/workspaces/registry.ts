/**
 * Reading the workspace registry — the app side of `quackback-cp`'s
 * `docs/workspace-registry-contract.md`.
 *
 * The control plane owns two tables in its own Postgres:
 * `cp_workspace_hostnames` (hostname → workspace, hostname is the primary key, so
 * fleet-wide uniqueness is structural) and `cp_workspace_registry` (one row per
 * workspace, carrying everything needed to serve it). This module turns a Host
 * header into one of five outcomes, and only one of them carries a DSN.
 *
 * Three things are deliberate.
 *
 * **One query, not two.** A separate hostname lookup would open a window in
 * which the record and its hostnames disagree, and this runs on every cache
 * miss on the request path.
 *
 * **Validation is the vendored contract, not a local reading.** `validateWorkspaceRecord`
 * comes from `vendor/contract.ts`, copied byte-for-byte from the control plane
 * so the two repos cannot drift into two readings of the same record. A reader
 * that trusts the writer is one migration away from serving the wrong workspace.
 *
 * **Catalog identity (`pg_database_oid` / `db_name`) is read
 * here even though contract v1 does not carry it in `WorkspaceRecord`.** Those
 * columns are the anti-clone half of the fingerprint — see
 * `physical-identity.ts`. They are attached alongside the validated record
 * rather than smuggled into it, so the vendored schema stays byte-identical to
 * the control plane's.
 */
import postgres from 'postgres'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import type { PhysicalExpectation } from './physical-identity'
import {
  validateWorkspaceRecord,
  type WorkspaceRecord,
  type WorkspaceResolution,
} from './vendor/contract'

const log = logger.child({ component: 'workspace-registry' })

/**
 * A validated record plus the physical placement the contract does not model.
 *
 * Structurally a `WorkspaceRecord`, so everything typed against the contract keeps
 * working; `physical` is additive.
 */
export interface WorkspaceDescriptor extends WorkspaceRecord {
  readonly physical: PhysicalExpectation
}

export type WorkspaceLookup =
  | { kind: 'ok'; workspace: WorkspaceDescriptor }
  | Exclude<WorkspaceResolution, { kind: 'ok' }>

interface RegistryRow {
  workspace_key: string
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
  mail_slug: string
  ai_enabled: boolean
  revision: string | number
  pg_database_oid: string | number | null
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
export function controlIdleSeconds(): number {
  return Math.ceil(config.workspaceRegistryTtlMs / 1000) + 15
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
 * pooled process may touch without a workspace scope, and never to be confused with
 * a workspace pool.
 *
 * ## It releases between reads, and that is a decision with a cost
 *
 * This connection used to be held open on the grounds that a control database is
 * always warm anyway. Measured, "always warm" meant **95% active for 23 hours**
 * — a compute billed continuously so that a cache miss could save a connect. It
 * is not exempt from the cost model just because it is not per workspace, so
 * `idle_timeout` now lets the socket go and the compute suspend.
 *
 * The cost, stated rather than discovered: the registry read happens on a cache
 * miss *before* the workspace connection is opened, so the first request to a
 * fleet that has been idle long enough for both computes to suspend pays a
 * control wake and then a workspace wake, **in series**. Two cold starts, not one.
 *
 * What keeps that off the common path is that the control database is shared.
 * Every hostname's miss lands on it, so it stays warm while *any* workspace in the
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
    throw new Error(
      'QUACKBACK_CONTROL_DATABASE_URL is not set; the workspace registry cannot be read'
    )
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

/**
 * Exported so a test can read the column list back.
 *
 * A column added to {@link RegistryRow} and to {@link toRecord} but not here
 * projects `undefined` for every workspace at once, which the contract refuses:
 * a fleet-wide 503 on every hostname, from an omission that reads as complete in
 * every other file that mentions the field. Nothing that takes a row as input —
 * which is every other test in this module — can see it.
 */
export const SELECT_COLUMNS = `
  r.workspace_key, r.contract_version, r.state::text AS state, r.state_reason,
  r.primary_hostname, r.base_url,
  r.db_pooled_url, r.db_direct_url, r.db_name, r.db_role, r.db_credential_ref,
  r.app_secrets_ref,
  r.workspace_id, r.fingerprint_stamped_at,
  r.storage, r.email_from, r.mail_slug, r.ai_enabled, r.revision,
  r.pg_database_oid,
  COALESCE(
    (SELECT array_agg(h2.hostname ORDER BY h2.hostname)
       FROM cp_workspace_hostnames h2
      WHERE h2.workspace_key = r.workspace_key),
    ARRAY[]::text[]
  ) AS hostnames
`

/**
 * `example.com`, `Example.com:443` and `example.com.` all resolve to the same
 * registry key. Anything with a path, credentials, brackets (an IPv6 literal)
 * or a wildcard is not a workspace hostname and returns null rather than being
 * coerced into one.
 *
 * Same rule as the control plane's `normalizeHostHeader`; a port-bearing or
 * trailing-dot Host that failed to normalise would read as `unknown_host` and
 * 404 an entire workspace.
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

export async function resolveWorkspaceByHostname(
  hostHeader: string,
  sql: postgres.Sql = getControlSql()
): Promise<WorkspaceLookup> {
  const hostname = normalizeHostHeader(hostHeader)
  if (hostname === null) return { kind: 'unknown_host', hostname: String(hostHeader) }

  const rows = (await recordControlRead(
    sql.unsafe(
      `SELECT ${SELECT_COLUMNS}
       FROM cp_workspace_hostnames h
       JOIN cp_workspace_registry r ON r.workspace_key = h.workspace_key
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
 * Same contract, same refusals, keyed by workspace id — for background subsystems
 * that hold a workspace id rather than a Host header. The union is deliberately
 * the one the request path returns, so a sweeper cannot reach a DSN by a route
 * the request path forbids.
 */
export async function resolveWorkspaceById(
  workspaceKey: string,
  sql: postgres.Sql = getControlSql()
): Promise<WorkspaceLookup> {
  const rows = (await recordControlRead(
    sql.unsafe(
      `SELECT ${SELECT_COLUMNS} FROM cp_workspace_registry r WHERE r.workspace_key = $1 LIMIT 1`,
      [workspaceKey]
    )
  )) as unknown as RegistryRow[]

  const row = rows[0]
  if (!row) return { kind: 'unknown_host', hostname: '' }
  return interpretRow(row, row.primary_hostname)
}

/**
 * Every active workspace, for fleet-wide passes (sweeps, migration cohorts).
 *
 * Refused records are logged and dropped rather than returned, so a caller
 * iterating the fleet cannot act on a record the request path would refuse.
 */
export async function listActiveWorkspaces(sql: postgres.Sql = getControlSql()): Promise<{
  workspaces: WorkspaceDescriptor[]
  refused: Array<{ workspaceKey: string; problems: string[] }>
}> {
  const rows = (await recordControlRead(
    sql.unsafe(
      `SELECT ${SELECT_COLUMNS} FROM cp_workspace_registry r WHERE r.state = 'active' ORDER BY r.workspace_key`
    )
  )) as unknown as RegistryRow[]

  const workspaces: WorkspaceDescriptor[] = []
  const refused: Array<{ workspaceKey: string; problems: string[] }> = []
  for (const row of rows) {
    const lookup = interpretRow(row, row.primary_hostname)
    if (lookup.kind === 'ok') workspaces.push(lookup.workspace)
    else if (lookup.kind === 'invalid') {
      refused.push({ workspaceKey: row.workspace_key, problems: lookup.problems })
    }
  }
  return { workspaces, refused }
}

/**
 * State gate first, validation second — the control plane's own ordering.
 * A suspended workspace should report as suspended even if its record has some
 * unrelated defect, or suspending a stale workspace reads to the operator as
 * corruption.
 */
export function interpretRow(row: RegistryRow, hostname: string): WorkspaceLookup {
  if (row.state === 'suspended') {
    return {
      kind: 'suspended',
      workspaceKey: row.workspace_key,
      hostname,
      reason: row.state_reason ?? 'suspended',
    }
  }
  if (row.state === 'deleting') {
    return { kind: 'deleting', workspaceKey: row.workspace_key, hostname }
  }
  if (row.state !== 'active') {
    return {
      kind: 'invalid',
      workspaceKey: row.workspace_key,
      hostname,
      problems: [`unknown state '${row.state}'`],
    }
  }

  const result = validateWorkspaceRecord(toRecord(row))
  if (!result.ok) {
    log.error(
      { workspaceKey: row.workspace_key, hostname, problems: result.problems },
      'workspace registry record refused'
    )
    return { kind: 'invalid', workspaceKey: row.workspace_key, hostname, problems: result.problems }
  }

  return {
    kind: 'ok',
    workspace: {
      ...result.record,
      physical: {
        catalogName: emptyToNull(row.pg_database_oid != null ? row.db_name : null),
        catalogOid: emptyToNull(row.pg_database_oid == null ? null : String(row.pg_database_oid)),
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
    workspaceKey: row.workspace_key,
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
      expectedWorkspaceKey: row.workspace_key,
      expectedSelfReportedWorkspaceId: row.workspace_id,
      stampedAt:
        row.fingerprint_stamped_at instanceof Date
          ? row.fingerprint_stamped_at.toISOString()
          : String(row.fingerprint_stamped_at ?? ''),
    },
    secrets: { appSecretsRef: row.app_secrets_ref },
    storage: typeof row.storage === 'string' ? safeJson(row.storage) : row.storage,
    email: { from: row.email_from, mailSlug: row.mail_slug },
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
