/**
 * A pooled process must not be able to boot in a queue-consuming role.
 *
 * A BullMQ `Worker`'s run loop starts inside its constructor, so it keeps the
 * async context alive at construction for every job it ever handles. Seven
 * queue modules arm lazily on first enqueue — from inside a request, which
 * `middleware/request-scope.ts` wraps in `runWithTenantScope`. So the first
 * tenant to trigger an export, an import, an event fan-out or a help-centre
 * translation welded its scope onto the processor, and every later job from
 * every tenant ran against that tenant's database. Nothing errors: SAAS-
 * HOSTING-STACK.md §3's failure mode, reached by the DEFAULT configuration,
 * because an unset `QUACKBACK_ROLE` means `all`.
 *
 * The refusal lives in the config schema rather than in a runtime check so it
 * fires at boot with a message, before a single request is served.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// The thrown message is deliberately redacted ('Configuration validation
// failed') — the issue detail goes to the log so a boot failure never prints
// configuration to stdout. So the refusal is observed through the throw, and
// WHICH field was refused through the logged issues.
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

const POOLED_ENV = {
  QUACKBACK_TENANCY: 'pooled',
  QUACKBACK_CONTROL_DATABASE_URL: 'postgresql://cp@localhost:5432/control',
  BASE_URL: 'http://localhost:3000',
  SECRET_KEY: 'x'.repeat(48),
  REDIS_URL: 'redis://localhost:6379',
}

let saved: NodeJS.ProcessEnv

beforeEach(() => {
  saved = { ...process.env }
  for (const key of ['DATABASE_URL', 'QUACKBACK_ROLE', 'QUACKBACK_TENANCY']) delete process.env[key]
  Object.assign(process.env, POOLED_ENV)
})

afterEach(() => {
  process.env = saved
})

/** Load config fresh, returning the thrown error message or null on success. */
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

describe('QUACKBACK_TENANCY=pooled', () => {
  it('refuses to boot with QUACKBACK_ROLE unset — the default IS the dangerous one', async () => {
    delete process.env.QUACKBACK_ROLE

    const result = await boot()
    expect(result.refused).toBe(true)
    expect(result.paths).toContain('processRole')
  })

  it('refuses QUACKBACK_ROLE=all', async () => {
    process.env.QUACKBACK_ROLE = 'all'
    expect(await boot()).toEqual({ refused: true, paths: ['processRole'] })
  })

  it('refuses QUACKBACK_ROLE=worker', async () => {
    process.env.QUACKBACK_ROLE = 'worker'
    expect(await boot()).toEqual({ refused: true, paths: ['processRole'] })
  })

  it('accepts QUACKBACK_ROLE=web', async () => {
    // The positive control. Without it, "every role is refused" would satisfy
    // the three cases above while making pooled tenancy unbootable entirely.
    process.env.QUACKBACK_ROLE = 'web'
    expect(await boot()).toEqual({ refused: false, paths: [] })
  })

  it('says why, not just no — the message names the mechanism', async () => {
    // The operator sees a redacted throw and the issue in the log; the reason
    // has to be in the schema so it reaches whoever reads either.
    const source = readFileSync(join(__dirname, '../config.ts'), 'utf8')
    expect(source).toContain('QUACKBACK_ROLE must be "web" when QUACKBACK_TENANCY=pooled')
    expect(source).toContain('inherits the tenant scope')
  })
})

describe('QUACKBACK_TENANCY=single is untouched', () => {
  beforeEach(() => {
    process.env.QUACKBACK_TENANCY = 'single'
    delete process.env.QUACKBACK_CONTROL_DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://app@localhost:5432/quackback'
  })

  for (const role of ['web', 'worker', 'all']) {
    it(`accepts QUACKBACK_ROLE=${role}`, async () => {
      process.env.QUACKBACK_ROLE = role
      expect(await boot()).toEqual({ refused: false, paths: [] })
    })
  }

  it('accepts an unset QUACKBACK_ROLE, exactly as before', async () => {
    // Every self-hosted install runs this shape. The gate must be invisible to
    // them, or a §4 fix has broken the OSS deployment.
    delete process.env.QUACKBACK_ROLE
    expect(await boot()).toEqual({ refused: false, paths: [] })
  })
})

describe('the schema and the runtime reader agree on the role vocabulary', () => {
  it('accepts exactly the values queue/role.ts accepts', async () => {
    // `queue/role.ts` reads process.env directly so it works without a config
    // load; the schema parses the same variable for the gate above. Two readers
    // of one variable is how they drift, so this pins them together.
    const { getProcessRole } = await import('../queue/role')
    process.env.QUACKBACK_TENANCY = 'single'
    delete process.env.QUACKBACK_CONTROL_DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://app@localhost:5432/quackback'

    for (const [raw, expected] of [
      ['web', 'web'],
      ['worker', 'worker'],
      ['all', 'all'],
      ['nonsense', 'all'],
    ] as const) {
      process.env.QUACKBACK_ROLE = raw
      const { resetConfig, config } = await import('../config')
      resetConfig()
      expect(getProcessRole(), raw).toBe(expected)
      expect(config.processRole, raw).toBe(expected)
    }
  })
})
