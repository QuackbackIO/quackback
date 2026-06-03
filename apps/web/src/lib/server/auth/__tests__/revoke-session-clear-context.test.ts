/**
 * `revokeSession` is the chokepoint for dropping a freshly-minted session
 * inside an auth after-hook. Better Auth populates `ctx.context.newSession`
 * before our hooks run, and subsequent after-hooks read from it
 * (handleCountryCapture, future country-aware side-effects). Without
 * clearing newSession on revoke, those later hooks act on a session
 * that's already been deleted — at best a benign country stamp, at
 * worst a silent side-effect for a sign-in that the policy declined.
 *
 * This test pins the contract: revokeSession must null out newSession
 * AND delete the cookie AND delete the row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDelete = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })

vi.mock('@/lib/server/db', () => ({
  db: { delete: (...a: unknown[]) => mockDelete(...a) },
  session: { token: 'session.token' },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
}))

const mockDeleteSessionCookie = vi.fn()
vi.mock('better-auth/cookies', () => ({
  deleteSessionCookie: (...a: unknown[]) => mockDeleteSessionCookie(...a),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('revokeSession — context cleanup', () => {
  it('clears ctx.context.newSession so subsequent after-hooks no-op (G10)', async () => {
    const ctx = {
      context: {
        newSession: { user: { id: 'usr_xyz' }, session: { token: 'tok_abc' } },
      },
    } as unknown as Parameters<typeof revokeSessionPrivate>[0]

    await revokeSessionPrivate(ctx, 'tok_abc')

    // The row delete fired and the cookie was cleared as before...
    expect(mockDelete).toHaveBeenCalled()
    expect(mockDeleteSessionCookie).toHaveBeenCalledWith(ctx)
    // ...AND newSession is now null so handleCountryCapture / any
    // future after-hook that reads it can short-circuit safely.
    const ctxAfter = ctx as unknown as { context: { newSession: unknown } }
    expect(ctxAfter.context.newSession).toBeNull()
  })

  it('leaves a ctx without context untouched (defensive)', async () => {
    const ctx = {} as Parameters<typeof revokeSessionPrivate>[0]
    await expect(revokeSessionPrivate(ctx, 'tok')).resolves.not.toThrow()
  })
})

// We're exercising a non-exported helper. Re-export it via a tiny shim
// in the test module so we don't pollute the production API surface.
import * as hooksModule from '../hooks'
const revokeSessionPrivate = (
  hooksModule as unknown as { revokeSession: (ctx: unknown, token: string) => Promise<void> }
).revokeSession
