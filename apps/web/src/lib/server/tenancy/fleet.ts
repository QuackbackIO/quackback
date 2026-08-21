/**
 * Running background work for every tenant.
 *
 * Roughly 25–35 files across ~15 background
 * subsystems run with no request scope at all — sweeps, queues, the relay,
 * migrations, CLI backfills, the readiness probe. Each needs a tenant scope, and
 * each needs a per-subsystem answer to one question: *iterate all tenants per
 * tick, or give each tenant its own schedule?*
 *
 * This module is the "iterate all tenants per tick" answer, which is the right
 * one for everything already shaped as a periodic sweep. Per-tenant scheduling
 * is a Postgres-queue concern and belongs with the lease primitive, not here.
 *
 * Two properties are deliberate.
 *
 * **Single-tenant behaviour is untouched.** Under `QUACKBACK_TENANCY=single`
 * `runFleetPass` calls the body exactly once, with no scope, exactly as the
 * sweeper does today. Self-hosted installs get no new machinery and no new
 * failure modes.
 *
 * **One tenant's failure never ends the pass.** A sweep that aborted the fleet
 * because tenant 7 of 400 had a refused fingerprint would turn a single bad
 * record into a fleet-wide outage of every sweeper. Failures are counted,
 * logged with their tenant, and the pass continues — which is the same choice
 * `listActiveTenants` makes when it drops refused records rather than throwing.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { listActiveTenants, type TenantDescriptor } from './registry'
import { acquireScopeForTenantId, acquireTenantScope } from './resolver'
import { runWithTenantScope, type TenantScopeOrigin } from './tenant-context'

const log = logger.child({ component: 'tenant-fleet' })

export interface FleetPassResult {
  /** Tenants the body ran to completion for. */
  succeeded: number
  /** Tenants whose body threw. */
  failed: number
  /** Tenants that could not be scoped at all (suspended, invalid, refused). */
  skipped: number
}

/**
 * How many tenants one fleet pass works on at once.
 *
 * Bounded so a pass cannot open a connection burst proportional to fleet size
 * against the shared server; concurrent so a pass's wall time is not N times
 * the slowest tenant.
 */
const FLEET_PASS_CONCURRENCY = 6

/** Run `body` once per active tenant, each inside its own tenant scope. */
export async function runFleetPass(
  origin: TenantScopeOrigin,
  body: (tenant: TenantDescriptor | null) => Promise<void>
): Promise<FleetPassResult> {
  if (!config.isPooledTenancy) {
    await body(null)
    return { succeeded: 1, failed: 0, skipped: 0 }
  }

  const { tenants, refused } = await listActiveTenants()
  if (refused.length > 0) {
    log.error({ refused }, 'fleet pass skipping tenants with invalid registry records')
  }

  const result: FleetPassResult = { succeeded: 0, failed: 0, skipped: refused.length }

  const runOne = async (tenant: TenantDescriptor): Promise<void> => {
    const acquisition = await acquireTenantScope(tenant, origin)
    if (acquisition.kind !== 'ok') {
      result.skipped += 1
      log.error(
        { tenantId: tenant.tenantId, kind: acquisition.kind },
        'fleet pass could not scope tenant'
      )
      return
    }
    try {
      await runWithTenantScope(acquisition.scope, () => body(tenant))
      result.succeeded += 1
    } catch (err) {
      result.failed += 1
      log.error({ err, tenantId: tenant.tenantId }, 'fleet pass body failed for tenant')
    }
  }

  let next = 0
  const workers = Array.from(
    { length: Math.min(FLEET_PASS_CONCURRENCY, tenants.length) },
    async () => {
      while (next < tenants.length) {
        const tenant = tenants[next]!
        next += 1
        await runOne(tenant)
      }
    }
  )
  await Promise.all(workers)

  return result
}

/**
 * A scope that could not be opened, with the reason still attached.
 *
 * This used to be a bare `Error` with the kind interpolated into its message,
 * and the loss was not cosmetic: `acquireTenantScope` classifies every refusal
 * with a `code`, and a caller that has to parse prose to recover it cannot tell
 * `app_secret_no_resolver` — which no retry will ever fix — from a compute that
 * is merely still starting. The job tier reconnecting once per second to a
 * tenant refused for the former is precisely what this class exists to let it
 * stop doing.
 */
export class TenantScopeUnavailableError extends Error {
  readonly tenantId: string
  readonly kind: string
  readonly code: string
  constructor(
    tenantId: string,
    origin: TenantScopeOrigin,
    kind: string,
    code: string,
    detail?: string
  ) {
    super(
      `Cannot open a ${origin} scope for tenant ${tenantId}: ${kind}` +
        (detail ? ` — ${detail}` : '')
    )
    this.name = 'TenantScopeUnavailableError'
    this.tenantId = tenantId
    this.kind = kind
    this.code = code
  }
}

/**
 * Run `body` inside one named tenant's scope.
 *
 * For work that already knows its tenant: a queue job carrying `tenantId` in its
 * payload, a CLI script given `--tenant`, the migrator. Throws rather than
 * degrading, because a caller that named a tenant and got a different one (or
 * none) has no safe fallback.
 */
export async function withTenantScopeById<T>(
  tenantId: string,
  origin: TenantScopeOrigin,
  body: () => Promise<T>
): Promise<T> {
  const acquisition = await acquireScopeForTenantId(tenantId, origin)
  if (acquisition.kind !== 'ok') {
    throw new TenantScopeUnavailableError(
      tenantId,
      origin,
      acquisition.kind,
      'code' in acquisition ? acquisition.code : acquisition.kind,
      'detail' in acquisition ? acquisition.detail : undefined
    )
  }
  return runWithTenantScope(acquisition.scope, body)
}
