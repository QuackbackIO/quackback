/**
 * Process-lifetime work armed from inside a request.
 *
 * `functions/bootstrap.ts` starts telemetry from a `setTimeout` scheduled while
 * serving the pod's first page. AsyncLocalStorage carries that request's store
 * into the timer, into `startTelemetry`, and into the hourly `setInterval` it
 * arms — for the life of the process.
 *
 * Under pooled tenancy the store also carries the **tenant scope**, and
 * `withSweepLock` fans a tick across the fleet only `if (isPooledTenancy() &&
 * !getTenantScope())`. So an inherited scope means it never fans out: whichever
 * tenant rendered the first page owns the fleet's telemetry forever — an hourly
 * claim in *its* database, no ping for anyone else, and `telemetry/instance-id.ts`
 * repeatedly issuing an unlocked read-modify-write of *its* `settings.metadata`,
 * which is the write SAAS-HOSTING-STACK.md §3 names as able to drop the
 * fingerprint stamp.
 *
 * Three cases, and the first is what makes the other two mean anything: it
 * proves the leak is real, so "no scope in the timer" is a property of the fix
 * rather than of AsyncLocalStorage not propagating in the first place.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  fleetPasses: 0,
  locksTakenInScope: [] as (string | null)[],
  pooled: true,
}))

vi.mock('@/lib/server/tenancy/mode', () => ({
  isPooledTenancy: () => hoisted.pooled,
  POOLED_TENANCY: 'pooled',
}))

vi.mock('@/lib/server/tenancy/fleet', () => ({
  runFleetPass: async (_origin: string, body: () => Promise<void>) => {
    hoisted.fleetPasses += 1
    await body()
    return { succeeded: 1, failed: 0, skipped: 0 }
  },
}))

vi.mock('@/lib/server/db', async () => {
  const { getCurrentTenant } = await import('@/lib/server/tenancy/tenant-context')
  return {
    db: {
      execute: async () => {
        // Where the lock is actually taken, and under which tenant.
        hoisted.locksTakenInScope.push(getCurrentTenant()?.tenantId ?? null)
        return [{ name: 'telemetry_ping', acquired_at: new Date() }]
      },
    },
  }
})

const { withSweepLock } = await import('../sweep-lock')
const { withTenant } = await import('./tenant-scope')
const { getTenantScope } = await import('@/lib/server/tenancy/tenant-context')
const { runWithoutLogContext } = await import('@/lib/server/log-context')

/**
 * Which tenants' databases the lock touched, deduped.
 *
 * `withSweepLock` issues two statements per acquisition (the claim and the
 * release), so the raw list double-counts. The claim under test is *whose*
 * database was written, not how many statements it took.
 */
function tenantsTouched(): (string | null)[] {
  return [...new Set(hoisted.locksTakenInScope)]
}

/** Arm a timer the way `bootstrap.ts` does, and resolve when it has run. */
function armTimer(body: () => void | Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => void Promise.resolve(body()).then(() => resolve()), 0)
  })
}

beforeEach(() => {
  hoisted.fleetPasses = 0
  hoisted.locksTakenInScope.length = 0
  hoisted.pooled = true
})

describe('a timer armed inside a request', () => {
  it('CONTROL: inherits the arming request’s tenant scope', async () => {
    // The precondition for everything below. If AsyncLocalStorage did not
    // propagate into the timer, the fix would be pinning nothing.
    let seen: string | null | undefined
    await withTenant('tenant-alpha', () =>
      armTimer(() => {
        seen = getTenantScope()?.tenant.tenantId ?? null
      })
    )

    expect(seen).toBe('tenant-alpha')
  })

  it('CONTROL: so the sweep never fans out, and claims one tenant’s database', async () => {
    await withTenant('tenant-alpha', () =>
      armTimer(() => withSweepLock('telemetry_ping', 1000, async () => {}))
    )

    expect(hoisted.fleetPasses).toBe(0)
    expect(tenantsTouched()).toEqual(['tenant-alpha'])
  })

  it('detached with runWithoutLogContext, it fans out across the fleet instead', async () => {
    await withTenant('tenant-alpha', () =>
      armTimer(() =>
        runWithoutLogContext(() => withSweepLock('telemetry_ping', 1000, async () => {}))
      )
    )

    expect(hoisted.fleetPasses).toBe(1)
  })

  it('detaches whichever tenant armed it — not just the first one', async () => {
    await withTenant('tenant-bravo', () =>
      armTimer(() =>
        runWithoutLogContext(() => withSweepLock('telemetry_ping', 1000, async () => {}))
      )
    )

    expect(hoisted.fleetPasses).toBe(1)
  })

  it('survives the nesting a real timer chain has: timer arms an interval', async () => {
    // `startTelemetry` arms a `setInterval` from inside the detached timer, and
    // every later tick inherits whatever context that call had. Detaching once
    // at the outer boundary has to cover the whole chain.
    let innerScope: string | null | undefined
    await withTenant('tenant-alpha', () =>
      armTimer(() =>
        runWithoutLogContext(
          () =>
            new Promise<void>((resolve) => {
              const handle = setInterval(() => {
                innerScope = getTenantScope()?.tenant.tenantId ?? null
                clearInterval(handle)
                resolve()
              }, 0)
            })
        )
      )
    )

    expect(innerScope).toBeNull()
  })
})

describe('single-tenant behaviour is untouched', () => {
  it('takes the lock directly, with no fleet pass, exactly as before', async () => {
    hoisted.pooled = false

    await armTimer(() =>
      runWithoutLogContext(() => withSweepLock('telemetry_ping', 1000, async () => {}))
    )

    expect(hoisted.fleetPasses).toBe(0)
    expect(tenantsTouched()).toEqual([null])
  })
})
