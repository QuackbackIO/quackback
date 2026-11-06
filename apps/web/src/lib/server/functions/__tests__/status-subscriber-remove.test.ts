/**
 * removeStatusSubscriberFn: the admin Remove action on the subscriber list.
 * It runs behind the status_page.manage gate and hands the chosen principal
 * to the domain removal, which keeps the row and only sets the opt-out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    }
    return chain
  },
}))

const mockRequireAuth = vi.hoisted(() => vi.fn())
vi.mock('../auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  getOptionalAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
}))
vi.mock('../portal-access', () => ({ resolvePortalAccessForRequest: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.status', () => ({
  getStatusSettings: vi.fn(),
  updateStatusSettings: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceStatusComponentLimit: vi.fn(),
}))

const mockRemove = vi.fn()
vi.mock('@/lib/server/domains/status', () => ({
  removeStatusSubscriberByAdmin: (...args: unknown[]) => mockRemove(...args),
}))

import { removeStatusSubscriberFn } from '../status'

const PRINCIPAL_ID = 'principal_01h455vb4pex5vsknk084sn02q'

const remove = removeStatusSubscriberFn as unknown as (args: {
  data: { principalId: string }
}) => Promise<{ success: boolean; removed: boolean }>

beforeEach(() => {
  mockRequireAuth.mockReset().mockResolvedValue({ principal: { id: 'principal_admin' } })
  mockRemove.mockReset().mockResolvedValue({ removed: true })
})

describe('removeStatusSubscriberFn', () => {
  it('requires status_page.manage before touching anyone', async () => {
    await remove({ data: { principalId: PRINCIPAL_ID } })

    expect(mockRequireAuth).toHaveBeenCalledWith({ permission: 'status_page.manage' })
  })

  it('removes the chosen subscriber and reports the outcome', async () => {
    await expect(remove({ data: { principalId: PRINCIPAL_ID } })).resolves.toEqual({
      success: true,
      removed: true,
    })
    expect(mockRemove).toHaveBeenCalledWith(PRINCIPAL_ID)
  })

  it('reports removed: false when the person was already opted out', async () => {
    mockRemove.mockResolvedValueOnce({ removed: false })

    await expect(remove({ data: { principalId: PRINCIPAL_ID } })).resolves.toEqual({
      success: true,
      removed: false,
    })
  })

  it('does not remove anyone when the caller lacks the permission', async () => {
    mockRequireAuth.mockRejectedValueOnce(new Error('forbidden'))

    await expect(remove({ data: { principalId: PRINCIPAL_ID } })).rejects.toThrow('forbidden')
    expect(mockRemove).not.toHaveBeenCalled()
  })
})
