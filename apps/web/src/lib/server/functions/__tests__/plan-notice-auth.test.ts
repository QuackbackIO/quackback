/**
 * Regression: `getPlanNotice` shipped with zero auth check — any
 * unauthenticated RPC call to the server-fn endpoint could read
 * whatever the operator put in tierLimits.notice (label/message/
 * actionUrl), e.g. billing or maintenance details. The admin route
 * gates the UI path on admin/member, but the handler itself must
 * enforce the same boundary.
 *
 * This pins the contract at the handler boundary: requireAuth({roles:
 * ['admin', 'member']}) is invoked before tier limits are read.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockGetTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

type AnyHandler = () => Promise<unknown>

const handlers: AnyHandler[] = []
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
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

let getPlanNoticeHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  hoisted.mockGetTierLimits.mockResolvedValue({})
  if (handlers.length === 0) await import('../plan-notice')
  getPlanNoticeHandler = handlers[0]
})

describe('getPlanNotice — team-member gate', () => {
  it('rejects an unauthenticated caller without reading tier limits', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(new Error('Authentication required'))

    await expect(getPlanNoticeHandler()).rejects.toThrow(/auth/i)

    expect(hoisted.mockRequireAuth).toHaveBeenCalledWith(
      expect.objectContaining({ permission: PERMISSIONS.MEMBER_VIEW })
    )
    expect(hoisted.mockGetTierLimits).not.toHaveBeenCalled()
  })

  it('refuses a portal-user caller', async () => {
    hoisted.mockRequireAuth.mockRejectedValueOnce(
      new Error('Access denied: Requires [admin, member], got user')
    )

    await expect(getPlanNoticeHandler()).rejects.toThrow(/denied/i)

    expect(hoisted.mockGetTierLimits).not.toHaveBeenCalled()
  })

  it('returns the notice for a team member', async () => {
    hoisted.mockRequireAuth.mockResolvedValueOnce({
      user: { id: 'usr_member' },
      principal: { id: 'prn_member', role: 'member' },
    })
    const notice = {
      label: 'Pro',
      message: 'Renewal due',
      actionUrl: 'https://example.com/billing',
    }
    hoisted.mockGetTierLimits.mockResolvedValueOnce({ notice })

    await expect(getPlanNoticeHandler()).resolves.toEqual(notice)
  })
})
