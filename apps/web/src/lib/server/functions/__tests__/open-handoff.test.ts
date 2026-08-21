import { describe, expect, it, vi, beforeEach } from 'vitest'
import { consumeOpenHandoff } from '../origin-transfer'

const hoisted = vi.hoisted(() => ({ handler: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/server/auth', () => ({
  auth: { handler: hoisted.handler, api: { getSession: hoisted.getSession } },
}))

describe('consumeOpenHandoff', () => {
  beforeEach(() => {
    hoisted.handler.mockReset()
    hoisted.getSession.mockReset()
    hoisted.getSession.mockResolvedValue(null)
  })

  it('does not require an identity projection', async () => {
    hoisted.handler.mockResolvedValue({
      ok: true,
      headers: {
        getSetCookie: () => ['session=abc; Path=/; HttpOnly'],
        get: () => null,
      },
    })
    const result = await consumeOpenHandoff({ ott: 'token-1' })
    expect(result).toEqual({
      kind: 'redirect',
      to: '/',
      cookies: ['session=abc; Path=/; HttpOnly'],
    })
    expect(hoisted.handler).toHaveBeenCalledOnce()
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
})
