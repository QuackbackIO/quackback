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
    recordAuditEvent: vi.fn(),
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
    // Pass-through tx — the handler now wraps its writes in
    // db.transaction(fn); the tx object exposes the same delete/update
    // surface so the existing call-site assertions still apply.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ delete: hoisted.deleteFn, update: hoisted.updateFn }),
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

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.recordAuditEvent,
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
  withAuditEvent: async (
    spec: { event: string; metadata?: Record<string, unknown>; [k: string]: unknown },
    fn: () => Promise<unknown>
  ) => {
    try {
      const result = await fn()
      await hoisted.recordAuditEvent({ ...spec, outcome: 'success' })
      return result
    } catch (error) {
      const reason =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : error instanceof Error
            ? error.message
            : 'UNEXPECTED'
      await hoisted.recordAuditEvent({
        ...spec,
        outcome: 'failure',
        metadata: { ...(spec.metadata ?? {}), reason },
      })
      throw error
    }
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.deleteFn.mockImplementation(() => ({ where: hoisted.deleteWhere }))
  hoisted.updateFn.mockImplementation(() => ({ set: hoisted.setStub }))
  hoisted.setStub.mockImplementation(() => ({ where: hoisted.updateWhere }))
  hoisted.deleteWhere.mockResolvedValue(undefined)
  hoisted.recordAuditEvent.mockResolvedValue(undefined)
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
    hoisted.requireAuth.mockResolvedValue({
      user: { id: 'user_admin', email: 'admin@example.com' },
      principal: { id: 'principal_admin', role: 'admin' },
    })

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

  it('records two_factor.reset_by_admin audit event on success', async () => {
    hoisted.requireAuth.mockResolvedValue({
      user: { id: 'user_admin', email: 'admin@example.com' },
      principal: { id: 'principal_admin', role: 'admin' },
    })

    await adminResetTwoFactor({ data: { userId: 'user_target' } })

    expect(hoisted.recordAuditEvent).toHaveBeenCalledTimes(1)
    const call = hoisted.recordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('two_factor.reset_by_admin')
    expect(call.outcome).toBe('success')
    expect(call.actor).toMatchObject({
      userId: 'user_admin',
      email: 'admin@example.com',
      role: 'admin',
    })
    expect(call.target).toEqual({ type: 'user', id: 'user_target' })
  })

  it('records a failure audit row when the underlying transaction throws', async () => {
    hoisted.requireAuth.mockResolvedValue({
      user: { id: 'user_admin', email: 'admin@example.com' },
      principal: { id: 'principal_admin', role: 'admin' },
    })
    hoisted.deleteWhere.mockRejectedValueOnce(new Error('db down'))

    await expect(adminResetTwoFactor({ data: { userId: 'user_target' } })).rejects.toThrow(
      'db down'
    )

    expect(hoisted.recordAuditEvent).toHaveBeenCalledTimes(1)
    const call = hoisted.recordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('two_factor.reset_by_admin')
    expect(call.outcome).toBe('failure')
    expect(call.metadata).toMatchObject({ reason: 'db down' })
  })
})
