/**
 * Tests for the admin-only reset-two-factor server function.
 *
 *  - Rejects when requireAuth throws (non-admin).
 *  - Deletes the twoFactor row, clears user.twoFactorEnabled, and
 *    removes Better-Auth trust-device verification records on success.
 *
 * Uses the `createServerFn` capture pattern shared with other
 * `functions/__tests__` suites — the registered handler is grabbed from
 * the chained `.handler(fn)` call so we can invoke it directly without
 * the TanStack runtime.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const hoisted = vi.hoisted(() => {
  const whereStub = vi.fn().mockResolvedValue(undefined)
  const setStub = vi.fn(() => ({ where: whereStub }))

  return {
    requireAuth: vi.fn(),
    deleteWhere: whereStub,
    updateWhere: whereStub,
    deleteFn: vi.fn(() => ({ where: whereStub })),
    updateFn: vi.fn(() => ({ set: setStub })),
    setStub,
    twoFactorTable: { userId: 'twoFactor.userId' },
    userTable: { id: 'user.id' },
    verificationTable: {
      identifier: 'verification.identifier',
      value: 'verification.value',
    },
    eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
    and: vi.fn((...parts: unknown[]) => ({ op: 'and', parts })),
    like: vi.fn((col: unknown, pat: unknown) => ({ op: 'like', col, pat })),
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    delete: hoisted.deleteFn,
    update: hoisted.updateFn,
  },
  twoFactor: hoisted.twoFactorTable,
  user: hoisted.userTable,
  verification: hoisted.verificationTable,
  eq: hoisted.eq,
  and: hoisted.and,
  like: hoisted.like,
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.deleteFn.mockImplementation(() => ({ where: hoisted.deleteWhere }))
  hoisted.updateFn.mockImplementation(() => ({ set: hoisted.setStub }))
  hoisted.setStub.mockImplementation(() => ({ where: hoisted.updateWhere }))
  hoisted.deleteWhere.mockResolvedValue(undefined)
})

// Load the module ONCE — the only handler captured here is
// adminResetTwoFactorFn (index 0).
await import('../admin-reset-two-factor')
const adminResetTwoFactor = handlers[0]

describe('adminResetTwoFactorFn', () => {
  it('requires admin role', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))

    await expect(adminResetTwoFactor({ data: { userId: 'user_target' } })).rejects.toThrow(
      'Access denied'
    )

    // Should bail before touching the DB.
    expect(hoisted.deleteFn).not.toHaveBeenCalled()
    expect(hoisted.updateFn).not.toHaveBeenCalled()
  })

  it('deletes twoFactor row + user flag + trust-device records', async () => {
    hoisted.requireAuth.mockResolvedValue({ user: { id: 'user_admin' } })

    const result = await adminResetTwoFactor({
      data: { userId: 'user_target' },
    })

    expect(result).toEqual({ success: true })

    // delete(twoFactor).where(eq(twoFactor.userId, userId))
    expect(hoisted.deleteFn).toHaveBeenCalledWith(hoisted.twoFactorTable)
    expect(hoisted.eq).toHaveBeenCalledWith(hoisted.twoFactorTable.userId, 'user_target')

    // update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId))
    expect(hoisted.updateFn).toHaveBeenCalledWith(hoisted.userTable)
    expect(hoisted.setStub).toHaveBeenCalledWith({ twoFactorEnabled: false })
    expect(hoisted.eq).toHaveBeenCalledWith(hoisted.userTable.id, 'user_target')

    // delete(verification).where(and(like(identifier, 'trust-device-%'), eq(value, userId)))
    expect(hoisted.deleteFn).toHaveBeenCalledWith(hoisted.verificationTable)
    expect(hoisted.like).toHaveBeenCalledWith(
      hoisted.verificationTable.identifier,
      'trust-device-%'
    )
    expect(hoisted.eq).toHaveBeenCalledWith(hoisted.verificationTable.value, 'user_target')
    expect(hoisted.and).toHaveBeenCalled()
  })
})
