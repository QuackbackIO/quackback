import { describe, expect, it, vi, beforeEach } from 'vitest'
import { consumeOpenHandoff, ottVerifyRequest } from '../origin-transfer'

const hoisted = vi.hoisted(() => {
  const snapshotRows: { value: string; expiresAt: Date }[][] = []
  return {
    handler: vi.fn(),
    getSession: vi.fn(),
    snapshotRows,
    nextSnapshot: () => snapshotRows.shift() ?? [],
  }
})

vi.mock('@/lib/server/auth', () => ({
  auth: { handler: hoisted.handler, api: { getSession: hoisted.getSession } },
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => hoisted.nextSnapshot(),
        }),
      }),
    }),
    insert: () => ({
      values: async () => undefined,
    }),
  },
  verification: {
    id: 'id',
    identifier: 'identifier',
    value: 'value',
    expiresAt: 'expiresAt',
  },
  eq: () => true,
}))

describe('ottVerifyRequest', () => {
  it('verifies as the workspace, not the control-plane referrer', () => {
    const request = ottVerifyRequest(
      'token-1',
      new Headers({
        host: 'ws-abc.quackback.io',
        cookie: 'cf_clearance=x',
        referer: 'https://app.quackback.io/dashboard',
        origin: 'https://app.quackback.io',
        'x-forwarded-proto': 'https',
      })
    )
    expect(request.url).toBe('https://ws-abc.quackback.io/api/auth/one-time-token/verify')
    expect(request.headers.get('origin')).toBe('https://ws-abc.quackback.io')
    expect(request.headers.get('referer')).toBeNull()
    expect(request.headers.get('cookie')).toBe('cf_clearance=x')
  })
})

describe('consumeOpenHandoff', () => {
  beforeEach(() => {
    hoisted.handler.mockReset()
    hoisted.getSession.mockReset()
    hoisted.getSession.mockResolvedValue(null)
    hoisted.snapshotRows.length = 0
  })

  it('does not require an identity projection', async () => {
    hoisted.handler.mockResolvedValue({
      ok: true,
      headers: {
        getSetCookie: () => ['session=abc; Path=/; HttpOnly'],
        get: () => null,
      },
    })
    const headers = new Headers({
      host: 'ws-abc.quackback.io',
      cookie: 'cf_clearance=x',
      referer: 'https://app.quackback.io/',
    })
    const result = await consumeOpenHandoff({ ott: 'token-1', headers })
    expect(result).toEqual({
      kind: 'redirect',
      to: '/',
      cookies: ['session=abc; Path=/; HttpOnly'],
    })
    expect(hoisted.handler).toHaveBeenCalledOnce()
    const verifyRequest = hoisted.handler.mock.calls[0]?.[0] as Request
    expect(verifyRequest.url).toBe('https://ws-abc.quackback.io/api/auth/one-time-token/verify')
    expect(verifyRequest.headers.get('origin')).toBe('https://ws-abc.quackback.io')
    expect(verifyRequest.headers.get('referer')).toBeNull()
    expect(hoisted.getSession).not.toHaveBeenCalled()
  })

  it('refuses a missing or rejected token without a silent no-op', async () => {
    await expect(consumeOpenHandoff({})).resolves.toEqual({ kind: 'error', status: 'invalid' })
    hoisted.handler.mockResolvedValue(new Response('no', { status: 400 }))
    await expect(consumeOpenHandoff({ ott: 'dead' })).resolves.toEqual({
      kind: 'error',
      status: 'invalid',
    })
    expect(hoisted.getSession).not.toHaveBeenCalled()
  })

  it('continues when the spent token is remounted with the new session', async () => {
    hoisted.handler.mockResolvedValue(new Response('no', { status: 400 }))
    hoisted.getSession.mockResolvedValue({ user: { id: 'user_1' } })
    const headers = new Headers({ cookie: 'session=abc' })
    await expect(consumeOpenHandoff({ ott: 'spent', headers })).resolves.toEqual({
      kind: 'redirect',
      to: '/',
      cookies: [],
    })
    expect(hoisted.getSession).toHaveBeenCalledWith({ headers })
  })

  it('lands on the workspace root even if a wizard returnTo is supplied', async () => {
    hoisted.handler.mockResolvedValue({
      ok: true,
      headers: {
        getSetCookie: () => ['session=abc; Path=/; HttpOnly'],
        get: () => null,
      },
    })
    await expect(
      consumeOpenHandoff({ ott: 'token-1', returnTo: '/onboarding/workspace' })
    ).resolves.toMatchObject({ kind: 'redirect', to: '/' })
  })

  it('retries when a parallel GET consumed the token before snapshot', async () => {
    const live = { value: 'sess', expiresAt: new Date(Date.now() + 60_000) }
    hoisted.snapshotRows.push([], [live])
    hoisted.handler
      .mockResolvedValueOnce(new Response('no', { status: 400 }))
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          getSetCookie: () => ['session=abc; Path=/; HttpOnly'],
          get: () => null,
        },
      })

    await expect(consumeOpenHandoff({ ott: 'token-1' })).resolves.toEqual({
      kind: 'redirect',
      to: '/',
      cookies: ['session=abc; Path=/; HttpOnly'],
    })
    expect(hoisted.handler).toHaveBeenCalledTimes(2)
  })
})
