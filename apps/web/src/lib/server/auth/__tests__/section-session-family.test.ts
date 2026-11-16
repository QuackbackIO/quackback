// @vitest-environment node
/**
 * The sign-out hook's edges. The family itself is tested against real
 * Postgres and the production auth instance in section-handoff.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  selectError: null as Error | null,
  logged: [] as Array<{ level: string; args: unknown[] }>,
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/server/db')>()
  const failing = () => {
    const chain: Record<string, unknown> = {}
    for (const step of ['from', 'where']) chain[step] = () => chain
    chain.limit = async () => {
      if (hoisted.selectError) throw hoisted.selectError
      return []
    }
    return chain
  }
  return { ...real, db: { select: failing } }
})

vi.mock('@/lib/server/logger', () => {
  const log = {
    child: () => log,
    info: (...args: unknown[]) => hoisted.logged.push({ level: 'info', args }),
    warn: (...args: unknown[]) => hoisted.logged.push({ level: 'warn', args }),
    error: (...args: unknown[]) => hoisted.logged.push({ level: 'error', args }),
  }
  return { logger: log }
})

const { signOutHandoffFamily } = await import('../section-session-family')

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    path: '/sign-out',
    getSignedCookie: vi.fn(async () => 'a-session-token'),
    context: { secret: 's', authCookies: { sessionToken: { name: 'better-auth.session_token' } } },
    ...overrides,
  }
}

describe('signOutHandoffFamily', () => {
  beforeEach(() => {
    hoisted.selectError = null
    hoisted.logged.length = 0
  })

  it('does nothing on any other path', async () => {
    const c = ctx({ path: '/sign-in/email' })
    await signOutHandoffFamily(c)
    expect(c.getSignedCookie).not.toHaveBeenCalled()
  })

  it('does nothing without a signed session cookie', async () => {
    const c = ctx({ getSignedCookie: vi.fn(async () => null) })
    await expect(signOutHandoffFamily(c)).resolves.toBeUndefined()
    expect(hoisted.logged).toEqual([])
  })

  it('never blocks the sign-out, and logs no token or error message', async () => {
    hoisted.selectError = new Error('select ... where token = $1 params: a-session-token')
    await expect(signOutHandoffFamily(ctx())).resolves.toBeUndefined()
    expect(hoisted.logged).toHaveLength(1)
    expect(hoisted.logged[0]!.level).toBe('error')
    expect(JSON.stringify(hoisted.logged)).not.toContain('a-session-token')
  })
})
