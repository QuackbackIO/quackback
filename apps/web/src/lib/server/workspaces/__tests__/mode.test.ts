/**
 * The cheap read and the canonical read must never disagree.
 *
 * `db.ts` and `withSweepLock` ask `tenancy/mode.ts`; everything else asks
 * `config`. Two readings of one flag is exactly how a process ends up
 * single-workspace in one module and pooled in another — which, for this flag,
 * means one module refusing to serve without a scope while another quietly
 * connects to a fleet-wide database.
 *
 * So the agreement is pinned across every value the config schema accepts, plus
 * the shapes that reach a real process but not the schema: unset, empty, and a
 * value nobody declared.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPooledTenancy } from '../mode'

function stubValidEnvFor(tenancy: string | undefined): void {
  vi.stubEnv('BASE_URL', 'http://localhost:3000')
  vi.stubEnv('SECRET_KEY', 'a'.repeat(64))
  if (tenancy === undefined) vi.stubEnv('QUACKBACK_TENANCY', '')
  else vi.stubEnv('QUACKBACK_TENANCY', tenancy)
  // Each mode requires the opposite database story.
  if (tenancy === 'pooled') {
    vi.stubEnv('DATABASE_URL', '')
    vi.stubEnv('QUACKBACK_CONTROL_DATABASE_URL', 'postgresql://u@localhost:5432/control')
    // Pooled refuses a queue-consuming role: a BullMQ Worker permanently
    // inherits the workspace scope of whichever request armed it, and the default
    // role runs workers. See config.ts's pooled refinement.
    vi.stubEnv('QUACKBACK_ROLE', 'web')
  } else {
    vi.stubEnv('DATABASE_URL', 'postgresql://u@localhost:5432/x')
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('isPooledTenancy', () => {
  it.each([
    ['pooled', true],
    ['single', false],
    [undefined, false],
  ] as const)('%s -> %s, and config agrees', async (tenancy, expected) => {
    vi.resetModules()
    stubValidEnvFor(tenancy)

    expect(isPooledTenancy()).toBe(expected)

    const { config } = await import('@/lib/server/config')
    expect(config.isPooledTenancy).toBe(expected)
  })

  it.each(['', 'POOLED', 'Pooled', 'pooled ', 'true', '1', 'multi'])(
    'treats %o as single-workspace — only the exact value switches behaviour',
    (value) => {
      expect(isPooledTenancy({ QUACKBACK_TENANCY: value })).toBe(false)
    }
  )

  it('reads the environment it is given, not the ambient one', () => {
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    expect(isPooledTenancy({ QUACKBACK_TENANCY: 'single' })).toBe(false)
    expect(isPooledTenancy()).toBe(true)
  })

  it('does NOT validate the rest of the configuration', async () => {
    // The whole reason this exists: `db.ts` is imported by 537 files, and the
    // first `db` access must not turn an unrelated missing variable into a
    // database error.
    vi.stubEnv('QUACKBACK_TENANCY', 'pooled')
    vi.stubEnv('SECRET_KEY', '')
    vi.stubEnv('BASE_URL', '')
    expect(() => isPooledTenancy()).not.toThrow()
    expect(isPooledTenancy()).toBe(true)

    // And the canonical read genuinely would have thrown on the same env, which
    // is what makes the previous assertion worth making.
    vi.resetModules()
    const { config } = await import('@/lib/server/config')
    expect(() => config.isPooledTenancy).toThrow()
  })
})
