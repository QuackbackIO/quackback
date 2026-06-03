/**
 * Regression: `updateFeatureFlagsFn` shipped with zero auth check —
 * any unauthenticated RPC call could flip `helpCenter`, `analytics`,
 * and `aiFeedbackExtraction`. Flipping `helpCenter` exposes a public
 * subdomain; flipping `aiFeedbackExtraction` routes customer feedback
 * through an LLM. Both must be admin-only.
 *
 * This pins the contract at the handler boundary: requireAuth({roles:
 * ['admin']}) is invoked before any write.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockUpdateFeatureFlags: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  updateFeatureFlags: hoisted.mockUpdateFeatureFlags,
}))

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        handlers.push(fn)
        return chain
      },
    }
    return chain
  },
}))

let updateFeatureFlagsHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  hoisted.mockUpdateFeatureFlags.mockResolvedValue({ analytics: true })
  if (handlers.length === 0) await import('../feature-flags')
  updateFeatureFlagsHandler = handlers[0]
})

describe('updateFeatureFlagsFn — admin gate', () => {
  it('requires admin auth (G12)', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('Authentication required'))

    await expect(updateFeatureFlagsHandler({ data: { analytics: true } })).rejects.toThrow(/auth/i)

    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ roles: expect.arrayContaining(['admin']) })
    )
    expect(hoisted.mockUpdateFeatureFlags).not.toHaveBeenCalled()
  })

  it('refuses a member-role caller', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('Admin role required'))

    await expect(updateFeatureFlagsHandler({ data: { helpCenter: true } })).rejects.toThrow(/role/i)

    expect(hoisted.mockUpdateFeatureFlags).not.toHaveBeenCalled()
  })

  it('proceeds for an authenticated admin', async () => {
    hoisted.mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_admin' },
      principal: { id: 'prn_admin', role: 'admin' },
    })

    await updateFeatureFlagsHandler({ data: { analytics: true } })

    expect(hoisted.mockUpdateFeatureFlags).toHaveBeenCalledWith({ analytics: true })
  })
})
