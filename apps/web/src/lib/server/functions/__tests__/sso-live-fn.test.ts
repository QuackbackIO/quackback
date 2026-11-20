/**
 * `getSsoLiveFn`: the Access & Security page asks it whether single sign-on
 * works right now. It answers `isSsoLive()` (the plan includes it, or plan
 * limits keep a provider signing in through the 7 days), and only to someone
 * who manages authentication.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

type Handler = () => Promise<unknown>

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = { validator: () => chain, handler: (fn: Handler) => fn }
    return chain
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  isSsoLive: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/auth/registered-providers', () => ({
  isSsoLive: hoisted.isSsoLive,
}))

const { getSsoLiveFn } = await import('../sso')
const getSsoLive = getSsoLiveFn as unknown as Handler

describe('getSsoLiveFn', () => {
  beforeEach(() => {
    hoisted.requireAuth.mockReset()
    hoisted.isSsoLive.mockReset()
    hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_1', role: 'admin' } })
  })

  it.each([true, false])('answers isSsoLive (%s)', async (live) => {
    hoisted.isSsoLive.mockResolvedValue(live)
    await expect(getSsoLive()).resolves.toBe(live)
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: PERMISSIONS.AUTH_MANAGE })
  })

  it('asks nothing of plan limits for someone who cannot manage authentication', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('forbidden'))
    await expect(getSsoLive()).rejects.toThrow('forbidden')
    expect(hoisted.isSsoLive).not.toHaveBeenCalled()
  })
})
