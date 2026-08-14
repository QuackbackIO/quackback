import { describe, expect, it, vi, beforeEach } from 'vitest'
import { consumeOpenHandoff } from '../origin-transfer'

const hoisted = vi.hoisted(() => ({ handler: vi.fn() }))
vi.mock('@/lib/server/auth', () => ({ auth: { handler: hoisted.handler } }))

describe('consumeOpenHandoff', () => {
  beforeEach(() => hoisted.handler.mockReset())

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
      to: '/onboarding/workspace',
      cookies: ['session=abc; Path=/; HttpOnly'],
    })
    expect(hoisted.handler).toHaveBeenCalledOnce()
  })

  it('refuses a missing or rejected token without a silent no-op', async () => {
    await expect(consumeOpenHandoff({})).resolves.toEqual({ kind: 'error', status: 'invalid' })
    hoisted.handler.mockResolvedValue(new Response('no', { status: 400 }))
    await expect(consumeOpenHandoff({ ott: 'dead' })).resolves.toEqual({
      kind: 'error',
      status: 'invalid',
    })
  })
})
