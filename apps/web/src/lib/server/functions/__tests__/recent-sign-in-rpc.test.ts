/**
 * The recent-sign-in refusal reaches the browser in a shape it can act on.
 *
 * Driven end to end through `_server-fn-rpc`: the browser half of a server
 * function posts to the real Start handler, through the app's real request and
 * function middleware and the real serializer, and the test reads what the
 * client fetcher hands back. Only the session lookup is stubbed.
 *
 * The last case pins what a thrown gate error looks like instead: a plain
 * `Error` that keeps its code and status, which the client's result check
 * does not read as the refusal.
 */
import './_server-fn-rpc'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const hoisted = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock('@/lib/server/auth/request-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/auth/request-session')>()),
  getRequestSession: () => hoisted.session(),
}))

const { createServerFnRpc } = await import('./_server-fn-rpc')
const { requireRecentSignIn } = await import('@/lib/server/auth/recent-sign-in')
const { RECENT_SIGN_IN_REQUIRED, isRecentSignInRequired, toRecentSignInRefusal } =
  await import('@/lib/shared/recent-sign-in')

const minutesAgo = (m: number) => new Date(Date.now() - m * 60 * 1000)

function signedIn(createdAt: Date, updatedAt: Date = createdAt) {
  return {
    session: {
      id: 'sess_1',
      token: 'tok',
      userId: 'user_me',
      scope: 'dashboard',
      createdAt,
      updatedAt,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    user: { id: 'user_me', email: 'me@example.com', name: 'Me', isAnonymous: false },
  }
}

const input = z.object({ changeId: z.string() })

let approve: (opts: { data: { changeId: string } }) => Promise<unknown>
let approveThrowing: (opts: { data: { changeId: string } }) => Promise<unknown>

beforeAll(async () => {
  const rpc = await createServerFnRpc()

  // The documented shape: the gate throws, the server function's boundary
  // returns the refusal, anything else still throws.
  approve = rpc.define({
    id: 'recent-sign-in-approve',
    method: 'POST',
    validator: input,
    handler: async ({ data }: { data: { changeId: string } }) => {
      try {
        await requireRecentSignIn()
        return { ok: true as const, changed: data.changeId }
      } catch (error) {
        const refusal = toRecentSignInRefusal(error)
        if (refusal) return refusal
        throw error
      }
    },
  })

  approveThrowing = rpc.define({
    id: 'recent-sign-in-approve-throwing',
    method: 'POST',
    validator: input,
    handler: async ({ data }: { data: { changeId: string } }) => {
      await requireRecentSignIn()
      return { ok: true as const, changed: data.changeId }
    },
  })
})

beforeEach(() => hoisted.session.mockReset())

describe('recent sign-in through the client path', () => {
  it('lets a person who signed in 5 minutes ago through', async () => {
    hoisted.session.mockResolvedValue(signedIn(minutesAgo(5)))
    const result = await approve({ data: { changeId: 'change_1' } })
    expect(result).toEqual({ ok: true, changed: 'change_1' })
    expect(isRecentSignInRequired(result)).toBe(false)
  })

  it('refuses a sign-in 11 minutes ago with the code the client acts on', async () => {
    hoisted.session.mockResolvedValue(signedIn(minutesAgo(11)))
    const result = await approve({ data: { changeId: 'change_1' } })
    expect(isRecentSignInRequired(result)).toBe(true)
    expect(result).toEqual({
      ok: false,
      code: RECENT_SIGN_IN_REQUIRED,
      message: expect.any(String),
    })
  })

  it('refuses an old session that was just refreshed', async () => {
    hoisted.session.mockResolvedValue(signedIn(minutesAgo(3 * 24 * 60), minutesAgo(0)))
    const result = await approve({ data: { changeId: 'change_1' } })
    expect(isRecentSignInRequired(result)).toBe(true)
  })

  it('refuses to start the harness a second time in one process', async () => {
    await expect(createServerFnRpc()).rejects.toThrow(/once per process/)
  })

  it('keeps the code on a thrown gate error, but the result check does not read it', async () => {
    hoisted.session.mockResolvedValue(signedIn(minutesAgo(11)))
    const error = await approveThrowing({ data: { changeId: 'change_1' } }).then(
      () => null,
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ code: RECENT_SIGN_IN_REQUIRED, statusCode: 403 })
    expect(isRecentSignInRequired(error)).toBe(false)
  })
})
