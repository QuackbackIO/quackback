/**
 * Which (tenancy, role) configurations a process may boot in.
 *
 * This file used to assert the opposite. An earlier fix put a refusal in the
 * config schema — pooled tenancy would only boot with `QUACKBACK_ROLE=web` —
 * and that composed with the pooled job tier, which is gated ON
 * `shouldRunWorkers()` and therefore never starts on `web`, into a fleet with
 * **no runnable pooled configuration at all**. Two guards, each correct alone,
 * jointly specifying an impossible system.
 *
 * It also contradicted the architecture it was implementing: the job tier
 * must be allowed to boot under pooled tenancy. Cloud now runs that tier
 * in the tenant-facing process (`QUACKBACK_ROLE=all` + scheduler). `worker`
 * remains a valid role for leftover soak capacity and for optional scale-out.
 *
 * So the role is free again, and the refusal moved to the noun it was always
 * about. It first became a seam that would not construct a `Worker` under
 * pooled tenancy; now that the queues it guarded run on the Postgres job tier,
 * it is the stricter and simpler property that no file under `apps/web/src`
 * imports the queue package at all — you cannot construct a `Worker` without
 * importing it. Pinned in `policy/no-bullmq/__tests__/no-bullmq.test.ts`.
 *
 * What is asserted here is the **permitted** matrix, not just the forbidden
 * one. A test that only lists refusals cannot notice that everything is
 * refused, which is precisely how the previous version passed while making the
 * fleet unbootable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const logged = vi.hoisted(() => ({ issues: [] as Array<{ path: string; code: string }> }))
vi.mock('@/lib/server/logger', () => ({
  logger: {
    child: () => ({
      error: (ctx: { issues?: Array<{ path: string; code: string }> }) => {
        if (ctx?.issues) logged.issues = ctx.issues
      },
      warn: () => {},
      info: () => {},
      debug: () => {},
    }),
  },
}))

const BASE_ENV = {
  BASE_URL: 'http://localhost:3000',
  SECRET_KEY: 'x'.repeat(48),
}

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = { ...process.env }
  for (const key of ['DATABASE_URL', 'QUACKBACK_ROLE', 'QUACKBACK_TENANCY']) delete process.env[key]
  Object.assign(process.env, BASE_ENV)
})

afterEach(() => {
  process.env = saved
})

function usePooled(): void {
  process.env.QUACKBACK_TENANCY = 'pooled'
  process.env.QUACKBACK_CONTROL_DATABASE_URL = 'postgresql://cp@localhost:5432/control'
  delete process.env.DATABASE_URL
}

function useSingle(): void {
  process.env.QUACKBACK_TENANCY = 'single'
  delete process.env.QUACKBACK_CONTROL_DATABASE_URL
  process.env.DATABASE_URL = 'postgresql://app@localhost:5432/quackback'
}

async function boot(): Promise<{ refused: boolean; paths: string[] }> {
  const { resetConfig, config } = await import('../config')
  resetConfig()
  logged.issues = []
  try {
    void config.tenancyMode
    return { refused: false, paths: [] }
  } catch {
    return { refused: true, paths: logged.issues.map((i) => i.path) }
  }
}

const ROLES = ['web', 'worker', 'all', 'migrator', undefined] as const

describe('every role boots under pooled tenancy', () => {
  // The five-row matrix, asserted as PERMITTED. `all` and `worker` are the
  // ones that matter: the pooled job tier only starts when shouldRunWorkers()
  // is true, so refusing those roles left the fleet with nothing that could
  // drain a queue.
  for (const role of ROLES) {
    it(`QUACKBACK_ROLE=${role ?? '(unset)'}`, async () => {
      usePooled()
      if (role === undefined) delete process.env.QUACKBACK_ROLE
      else process.env.QUACKBACK_ROLE = role

      expect(await boot()).toEqual({ refused: false, paths: [] })
    })
  }
})

describe('every role boots under single tenancy', () => {
  for (const role of ROLES) {
    it(`QUACKBACK_ROLE=${role ?? '(unset)'}`, async () => {
      useSingle()
      if (role === undefined) delete process.env.QUACKBACK_ROLE
      else process.env.QUACKBACK_ROLE = role

      expect(await boot()).toEqual({ refused: false, paths: [] })
    })
  }
})

describe('the database refusals the pooled mode DOES keep', () => {
  // The control for the matrix above. Without these, "everything boots" would
  // be satisfied by a schema that validates nothing, and the assertions would
  // pass for the wrong reason.
  it('refuses a pooled process carrying a fleet-wide DATABASE_URL', async () => {
    usePooled()
    process.env.DATABASE_URL = 'postgresql://app@localhost:5432/quackback'

    const result = await boot()
    expect(result.refused).toBe(true)
    expect(result.paths).toContain('databaseUrl')
  })

  it('refuses a pooled process with no control database', async () => {
    usePooled()
    delete process.env.QUACKBACK_CONTROL_DATABASE_URL

    const result = await boot()
    expect(result.refused).toBe(true)
    expect(result.paths).toContain('controlDatabaseUrl')
  })

  it('refuses a single-workspace process with no DATABASE_URL', async () => {
    useSingle()
    delete process.env.DATABASE_URL

    const result = await boot()
    expect(result.refused).toBe(true)
    expect(result.paths).toContain('databaseUrl')
  })
})

describe('the role vocabulary has one reader', () => {
  it('process-role.ts is the only place QUACKBACK_ROLE is interpreted', async () => {
    // The config schema no longer parses it, so there is one reader and no
    // second opinion to drift from. Tolerance for a nonsense value lives there
    // too — and it is fail-CLOSED: an unrecognised role resolves to `web` and
    // starts nothing, rather than to `all`, which would start everything on a
    // replica whose manifest said otherwise.
    const { getProcessRole, shouldRunWorkers } = await import('../process-role')
    for (const [raw, role, workers] of [
      ['web', 'web', false],
      ['worker', 'worker', true],
      ['all', 'all', true],
      ['migrator', 'migrator', false],
      ['nonsense', 'web', false],
    ] as const) {
      process.env.QUACKBACK_ROLE = raw
      expect(getProcessRole(), raw).toBe(role)
      expect(shouldRunWorkers(), raw).toBe(workers)
    }
  })
})
