/**
 * Unit tests for the audit log helper.
 *
 * Confirms the helper builds rows with the right shape, defaults
 * outcome to 'success', extracts IP/UA from common request headers,
 * and swallows insert errors so audit failures never block the
 * primary action (audit is best-effort, not transactional with the
 * mutation it records).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserId } from '@quackback/ids'

const mockInsertValues = vi.fn()
const mockInsert = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
  },
  auditLog: { __table: 'audit_log' },
}))

const { recordAuditEvent, withAuditEvent, actorFromAuth } = await import('../log')

beforeEach(() => {
  vi.clearAllMocks()
  mockInsertValues.mockResolvedValue(undefined)
  mockInsert.mockReturnValue({ values: mockInsertValues })
})

describe('recordAuditEvent', () => {
  it('records an event with the supplied actor, target, and metadata', async () => {
    await recordAuditEvent({
      event: 'sso.enforcement.domain.enabled',
      actor: {
        userId: 'user_01h' as UserId,
        email: 'admin@example.com',
        role: 'admin',
      },
      target: { type: 'sso_verified_domain', id: 'domain_01h' },
      before: { enforced: false },
      after: { enforced: true },
      metadata: { domain: 'example.com' },
    })

    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockInsertValues).toHaveBeenCalledTimes(1)

    const row = mockInsertValues.mock.calls[0][0]
    expect(row).toMatchObject({
      eventType: 'sso.enforcement.domain.enabled',
      eventOutcome: 'success',
      actorUserId: 'user_01h',
      actorEmail: 'admin@example.com',
      actorRole: 'admin',
      targetType: 'sso_verified_domain',
      targetId: 'domain_01h',
      beforeValue: { enforced: false },
      afterValue: { enforced: true },
      metadata: { domain: 'example.com' },
    })
  })

  it('defaults outcome to success when omitted', async () => {
    await recordAuditEvent({
      event: 'auth.password.disabled',
      actor: { email: 'a@b.com' },
    })

    expect(mockInsertValues.mock.calls[0][0].eventOutcome).toBe('success')
  })

  it('records explicit failure outcome', async () => {
    await recordAuditEvent({
      event: 'auth.method.blocked',
      outcome: 'failure',
      actor: { email: 'a@b.com' },
    })

    expect(mockInsertValues.mock.calls[0][0].eventOutcome).toBe('failure')
  })

  it('extracts ip and user-agent from headers', async () => {
    const headers = new Headers({
      'x-forwarded-for': '203.0.113.45, 10.0.0.1',
      'user-agent': 'Mozilla/5.0 (Test)',
    })

    await recordAuditEvent({
      event: 'sso.config.changed',
      actor: { email: 'a@b.com' },
      headers,
    })

    const row = mockInsertValues.mock.calls[0][0]
    expect(row.actorIp).toBe('203.0.113.45')
    expect(row.actorUserAgent).toBe('Mozilla/5.0 (Test)')
  })

  it('swallows insert errors and does not throw', async () => {
    mockInsertValues.mockRejectedValueOnce(new Error('connection refused'))

    await expect(
      recordAuditEvent({ event: 'sso.config.changed', actor: { email: 'a@b.com' } })
    ).resolves.toBeUndefined()
  })

  it('omits actor user id when actor is anonymous', async () => {
    await recordAuditEvent({
      event: 'auth.method.blocked',
      actor: { email: 'unknown@example.com' },
    })

    const row = mockInsertValues.mock.calls[0][0]
    expect(row.actorUserId).toBeNull()
  })
})

describe('actorFromAuth', () => {
  it('maps requireAuth output into an AuditActor', () => {
    const actor = actorFromAuth({
      user: { id: 'user_admin1' as never, email: 'admin@example.com', name: 'A', image: null },
      principal: { id: 'principal_admin1' as never, role: 'admin', type: 'user' },
      settings: { id: 'workspace_1' as never, slug: 's', name: 'n', logoKey: null },
    })

    expect(actor).toEqual({
      userId: 'user_admin1',
      email: 'admin@example.com',
      role: 'admin',
    })
  })
})

describe('withAuditEvent', () => {
  it('records success and returns the mutation result', async () => {
    const result = await withAuditEvent(
      {
        event: 'sso.config.changed',
        actor: { email: 'a@b.com' },
        metadata: { field: 'clientSecret' },
      },
      async () => ({ ok: true })
    )

    expect(result).toEqual({ ok: true })
    expect(mockInsertValues).toHaveBeenCalledTimes(1)
    expect(mockInsertValues.mock.calls[0][0].eventOutcome).toBe('success')
  })

  it('records failure with reason from error.code and rethrows', async () => {
    class MyError extends Error {
      code = 'SSO_DOMAIN_VERIFIED'
    }

    await expect(
      withAuditEvent({ event: 'sso.config.changed', actor: { email: 'a@b.com' } }, async () => {
        throw new MyError('boom')
      })
    ).rejects.toThrow('boom')

    expect(mockInsertValues).toHaveBeenCalledTimes(1)
    const row = mockInsertValues.mock.calls[0][0]
    expect(row.eventOutcome).toBe('failure')
    expect(row.metadata).toMatchObject({ reason: 'SSO_DOMAIN_VERIFIED' })
  })

  it('falls back to error message when no code is present', async () => {
    await expect(
      withAuditEvent({ event: 'sso.config.changed', actor: { email: 'a@b.com' } }, async () => {
        throw new Error('plain failure')
      })
    ).rejects.toThrow('plain failure')

    expect(mockInsertValues.mock.calls[0][0].metadata).toMatchObject({ reason: 'plain failure' })
  })

  it('caps reason length to keep PII out of unbounded error messages', async () => {
    const longMessage = 'x'.repeat(500)
    await expect(
      withAuditEvent({ event: 'sso.config.changed', actor: { email: 'a@b.com' } }, async () => {
        throw new Error(longMessage)
      })
    ).rejects.toThrow()

    const reason = (mockInsertValues.mock.calls[0][0].metadata as { reason: string }).reason
    expect(reason.length).toBeLessThanOrEqual(200)
  })

  it('preserves caller-supplied metadata on the failure event', async () => {
    await expect(
      withAuditEvent(
        {
          event: 'sso.config.changed',
          actor: { email: 'a@b.com' },
          metadata: { field: 'clientSecret', action: 'set' },
        },
        async () => {
          throw new Error('boom')
        }
      )
    ).rejects.toThrow('boom')

    expect(mockInsertValues.mock.calls[0][0].metadata).toMatchObject({
      field: 'clientSecret',
      action: 'set',
      reason: 'boom',
    })
  })
})
