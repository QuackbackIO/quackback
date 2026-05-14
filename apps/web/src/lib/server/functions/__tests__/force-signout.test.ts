/**
 * `forceSignOutUserFn` — admin-only session revocation.
 *
 *  - Requires `admin` role; portal-user / member callers rejected.
 *  - Deletes every `session` row for the target user and returns the
 *    number of rows removed.
 *  - Audits `session.revoked.individual` with the count and a
 *    `reason='admin_forced'` metadata tag.
 *
 * Uses the createServerFn-handler-capture pattern shared with the other
 * functions/__tests__ suites, but exposes `_handler` on the chain so the
 * specific exported fn from the multi-fn `admin.ts` module is addressable
 * by name (the index-based capture used elsewhere is too brittle here).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

const hoisted = vi.hoisted(() => {
  const returningMock = vi.fn()
  const whereMock = vi.fn(() => ({ returning: returningMock }))
  const deleteMock = vi.fn(() => ({ where: whereMock }))

  return {
    requireAuth: vi.fn(),
    recordAuditEvent: vi.fn(),
    sessionTable: { __name: 'session', id: 'session.id', userId: 'session.userId' },
    eq: vi.fn((col: unknown, val: unknown) => ({ op: 'eq', col, val })),
    deleteMock,
    whereMock,
    returningMock,
  }
})

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      _handler: undefined as AnyHandler | undefined,
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler) {
        chain._handler = fn
        return chain
      },
    }
    return chain
  },
}))

vi.mock('@/lib/server/db', () => ({
  db: { delete: hoisted.deleteMock },
  session: hoisted.sessionTable,
  invitation: { __name: 'invitation' },
  principal: { __name: 'principal' },
  user: { __name: 'user' },
  eq: hoisted.eq,
  and: vi.fn(),
  isOnboardingComplete: vi.fn(),
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
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// The admin.ts module has many fns. We only want forceSignOutUserFn — the
// other fns import their own deps lazily and won't trigger here.
const admin = await import('../admin')
const fn = (admin.forceSignOutUserFn as unknown as { _handler: AnyHandler })._handler

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.deleteMock.mockImplementation(() => ({ where: hoisted.whereMock }))
  hoisted.whereMock.mockImplementation(() => ({ returning: hoisted.returningMock }))
  hoisted.returningMock.mockResolvedValue([])
  hoisted.recordAuditEvent.mockResolvedValue(undefined)
})

describe('forceSignOutUserFn', () => {
  it('rejects non-admin callers (auth helper throws)', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))

    await expect(fn({ data: { userId: 'user_target' } })).rejects.toThrow('Access denied')

    expect(hoisted.deleteMock).not.toHaveBeenCalled()
    expect(hoisted.recordAuditEvent).not.toHaveBeenCalled()
  })

  it('deletes sessions for the target user', async () => {
    hoisted.requireAuth.mockResolvedValue({
      user: { id: 'user_admin', email: 'admin@example.com' },
      principal: { id: 'principal_admin', role: 'admin' },
    })
    hoisted.returningMock.mockResolvedValue([{ id: 'sess_1' }, { id: 'sess_2' }])

    const result = await fn({ data: { userId: 'user_target' } })

    expect(result).toEqual({ revokeCount: 2 })
    expect(hoisted.deleteMock).toHaveBeenCalledWith(hoisted.sessionTable)
    expect(hoisted.eq).toHaveBeenCalledWith(hoisted.sessionTable.userId, 'user_target')
  })

  it('returns count=0 when target has no active sessions, still emits audit', async () => {
    hoisted.requireAuth.mockResolvedValue({
      user: { id: 'user_admin', email: 'admin@example.com' },
      principal: { id: 'principal_admin', role: 'admin' },
    })
    hoisted.returningMock.mockResolvedValue([])

    const result = await fn({ data: { userId: 'user_target' } })

    expect(result).toEqual({ revokeCount: 0 })
    expect(hoisted.recordAuditEvent).toHaveBeenCalledTimes(1)
    expect(hoisted.recordAuditEvent.mock.calls[0][0].metadata).toMatchObject({
      count: 0,
      reason: 'admin_forced',
    })
  })

  it('emits session.revoked.individual audit with actor, target, and count metadata', async () => {
    hoisted.requireAuth.mockResolvedValue({
      user: { id: 'user_admin', email: 'admin@example.com' },
      principal: { id: 'principal_admin', role: 'admin' },
    })
    hoisted.returningMock.mockResolvedValue([{ id: 'sess_1' }])

    await fn({ data: { userId: 'user_target' } })

    expect(hoisted.recordAuditEvent).toHaveBeenCalledTimes(1)
    const call = hoisted.recordAuditEvent.mock.calls[0][0]
    expect(call.event).toBe('session.revoked.individual')
    expect(call.outcome).toBe('success')
    expect(call.actor).toMatchObject({
      userId: 'user_admin',
      email: 'admin@example.com',
      role: 'admin',
    })
    expect(call.target).toEqual({ type: 'user', id: 'user_target' })
    expect(call.metadata).toMatchObject({ count: 1, reason: 'admin_forced' })
  })
})
