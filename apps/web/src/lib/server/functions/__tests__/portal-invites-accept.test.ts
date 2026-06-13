/**
 * Unit tests for acceptPortalInviteFn.
 *
 * Covers the happy path, idempotent re-accept, terminal states (canceled /
 * expired), the security-critical email-mismatch check, and auth-required gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// createServerFn stub
// ---------------------------------------------------------------------------

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

// Handlers are registered in file-definition order. portal-invites.ts already
// registers 4 handlers before acceptPortalInviteFn (send, cancel, resend,
// fetch), so we capture all of them here.
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

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockDbUpdate: vi.fn(),
  // The accept handler now uses RETURNING to detect zero-row writes
  // (concurrent cancel / expiry / accept race). Tests can override this
  // per-case to simulate the race.
  mockDbUpdateReturning: vi.fn(
    (): Promise<Array<{ id: string; magicLinkTokens?: string[] }>> =>
      Promise.resolve([{ id: 'invite_1' }])
  ),
  mockDbQuery: {
    invitation: { findFirst: vi.fn() },
    principal: { findFirst: vi.fn() },
    user: { findFirst: vi.fn() },
  },
  mockDbInsert: vi.fn(),
  mockSendPortalInviteEmail: vi.fn(),
  mockMintMagicLinkUrl: vi.fn(),
  mockRevokeMagicLinkTokens: vi.fn(),
  mockGetEmailSafeUrl: vi.fn(),
  mockGetBaseUrl: vi.fn(),
  mockGenerateId: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({
  getSession: hoisted.mockGetSession,
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.mockRecordAuditEvent,
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
}))

vi.mock('@/lib/server/db', () => {
  const insertChain = { values: hoisted.mockDbInsert }
  const updateChain = {
    set: () => ({
      where: (...args: unknown[]) => {
        hoisted.mockDbUpdate(...args)
        return { returning: () => hoisted.mockDbUpdateReturning() }
      },
    }),
  }
  return {
    db: {
      query: hoisted.mockDbQuery,
      insert: () => insertChain,
      update: () => updateChain,
    },
    invitation: {
      id: 'id',
      email: 'email',
      kind: 'kind',
      status: 'status',
      expiresAt: 'expiresAt',
    },
    principal: { userId: 'userId', role: 'role', id: 'id' },
    user: { email: 'email', id: 'id' },
    eq: vi.fn((col, val) => ({ col, val })),
    and: vi.fn((...args: unknown[]) => args),
    or: vi.fn((...args: unknown[]) => args),
    gt: vi.fn((col, val) => ({ col, val })),
    sql: vi.fn((parts: TemplateStringsArray) => parts.raw[0]),
  }
})

vi.mock('@quackback/email', () => ({
  sendPortalInviteEmail: hoisted.mockSendPortalInviteEmail,
}))

vi.mock('@/lib/server/config', () => ({
  getBaseUrl: hoisted.mockGetBaseUrl,
}))

vi.mock('@quackback/ids', () => ({
  generateId: hoisted.mockGenerateId,
}))

vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  mintMagicLinkUrl: hoisted.mockMintMagicLinkUrl,
  revokeMagicLinkTokens: hoisted.mockRevokeMagicLinkTokens,
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getEmailSafeUrl: hoisted.mockGetEmailSafeUrl,
}))

// ---------------------------------------------------------------------------
// Handler index — accept is the 6th handler (index 5)
// send=0, cancel=1, resend=2, fetch=3, getLink=4, accept=5
// ---------------------------------------------------------------------------

const ACCEPT_IDX = 5

const FUTURE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
const PAST = new Date(Date.now() - 1000)

const SESSION_USER = {
  id: 'user_invitee',
  email: 'invitee@example.com',
  name: 'Invitee',
  emailVerified: true,
  image: null,
  principalType: 'user' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const PENDING_INVITE = {
  id: 'invite_1',
  email: 'invitee@example.com',
  kind: 'portal',
  status: 'pending',
  expiresAt: FUTURE,
}

let acceptHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()

  if (handlers.length === 0) {
    await import('../portal-invites')
  }

  acceptHandler = handlers[ACCEPT_IDX] as AnyHandler

  // Defaults
  hoisted.mockGetSession.mockResolvedValue({
    session: {
      id: 'sess_1',
      userId: SESSION_USER.id,
      expiresAt: FUTURE.toISOString(),
      token: 't',
      createdAt: '',
      updatedAt: '',
    },
    user: SESSION_USER,
  })
  hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(PENDING_INVITE)
  hoisted.mockDbQuery.principal.findFirst.mockResolvedValue(null)
  hoisted.mockDbUpdate.mockResolvedValue(undefined)
  // Default: the UPDATE finds + accepts the row (1 row returned).
  hoisted.mockDbUpdateReturning.mockResolvedValue([{ id: 'invite_1' }])
  hoisted.mockRecordAuditEvent.mockResolvedValue(undefined)
  hoisted.mockRequireAuth.mockResolvedValue(undefined)
  hoisted.mockSendPortalInviteEmail.mockResolvedValue({ sent: false })
  hoisted.mockGetBaseUrl.mockReturnValue('https://example.com')
  hoisted.mockGenerateId.mockReturnValue('invite_new')
  hoisted.mockDbInsert.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('acceptPortalInviteFn — auth gate', () => {
  it('throws when there is no session', async () => {
    hoisted.mockGetSession.mockResolvedValue(null)

    await expect(acceptHandler({ data: { inviteId: 'invite_1' } })).rejects.toThrow(
      'Authentication required'
    )
  })

  it('throws when session has no user', async () => {
    hoisted.mockGetSession.mockResolvedValue({ session: {}, user: null })

    await expect(acceptHandler({ data: { inviteId: 'invite_1' } })).rejects.toThrow(
      'Authentication required'
    )
  })
})

// ---------------------------------------------------------------------------
// Not found
// ---------------------------------------------------------------------------

describe('acceptPortalInviteFn — not found', () => {
  it('throws PORTAL_INVITE_NOT_FOUND when invite does not exist', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(null)

    await expect(acceptHandler({ data: { inviteId: 'invite_missing' } })).rejects.toThrow(
      'PORTAL_INVITE_NOT_FOUND'
    )
  })
})

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------

describe('acceptPortalInviteFn — terminal states', () => {
  it('returns { status: canceled } without accepting', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'canceled',
    })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect((result as { status: string }).status).toBe('canceled')
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('returns { status: expired } without accepting', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'pending',
      expiresAt: PAST,
    })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect((result as { status: string }).status).toBe('expired')
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Idempotent re-accept
// ---------------------------------------------------------------------------

describe('acceptPortalInviteFn — idempotent', () => {
  it('returns alreadyAccepted=true when invite is already accepted', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'accepted',
    })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    const r = result as { status: string; alreadyAccepted: boolean }
    expect(r.status).toBe('accepted')
    expect(r.alreadyAccepted).toBe(true)
  })

  it('does NOT record a second audit event on re-accept', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'accepted',
    })

    await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('does NOT call db update on re-accept', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'accepted',
    })

    await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('returns mismatch (not alreadyAccepted) when caller email differs on an already-accepted invite', async () => {
    // Invite is accepted, but the calling session belongs to a different user.
    // The email-mismatch guard must run before the alreadyAccepted short-circuit.
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'accepted',
    })
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1', userId: 'user_other' },
      user: { ...SESSION_USER, id: 'user_other', email: 'wrong@example.com' },
    })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect((result as { status: string }).status).toBe('mismatch')
  })
})

// ---------------------------------------------------------------------------
// Email mismatch — security-critical
// ---------------------------------------------------------------------------

describe('acceptPortalInviteFn — email mismatch (security)', () => {
  it('returns { status: mismatch } when session email does not match', async () => {
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1', userId: 'user_other' },
      user: { ...SESSION_USER, id: 'user_other', email: 'other@example.com' },
    })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect((result as { status: string }).status).toBe('mismatch')
  })

  it('does NOT update the invite on mismatch', async () => {
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1', userId: 'user_other' },
      user: { ...SESSION_USER, id: 'user_other', email: 'other@example.com' },
    })

    await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('does NOT record an audit event on mismatch', async () => {
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1', userId: 'user_other' },
      user: { ...SESSION_USER, id: 'user_other', email: 'other@example.com' },
    })

    await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('comparison is case-insensitive — uppercase session email matches lowercase invite', async () => {
    // Invite has lowercase; session has uppercase — should match, not mismatch.
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1', userId: SESSION_USER.id },
      user: { ...SESSION_USER, email: 'INVITEE@EXAMPLE.COM' },
    })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    const r = result as { status: string; alreadyAccepted: boolean }
    expect(r.status).toBe('accepted')
    expect(r.alreadyAccepted).toBe(false)
  })

  it('comparison is case-insensitive — uppercase invite email matches lowercase session', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      email: 'INVITEE@EXAMPLE.COM',
    })
    // Session has lowercase
    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    const r = result as { status: string; alreadyAccepted: boolean }
    expect(r.status).toBe('accepted')
    expect(r.alreadyAccepted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('acceptPortalInviteFn — happy path', () => {
  it('returns { status: accepted, alreadyAccepted: false }', async () => {
    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    const r = result as { status: string; alreadyAccepted: boolean }
    expect(r.status).toBe('accepted')
    expect(r.alreadyAccepted).toBe(false)
  })

  it('updates invite status to accepted', async () => {
    await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect(hoisted.mockDbUpdate).toHaveBeenCalled()
  })

  it('records a portal.invite.accepted audit event', async () => {
    await acceptHandler({ data: { inviteId: 'invite_1' } })

    const auditCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.invite.accepted'
    )
    expect(auditCall).toBeDefined()
  })

  it('revokes the invite token set on accept so sibling links can no longer sign in', async () => {
    // An invite resent/copied has more than one live token; accepting via one
    // must kill the rest.
    hoisted.mockDbUpdateReturning.mockResolvedValue([
      { id: 'invite_1', magicLinkTokens: ['tok_used', 'tok_sibling'] },
    ])

    await acceptHandler({ data: { inviteId: 'invite_1' } })

    expect(hoisted.mockRevokeMagicLinkTokens).toHaveBeenCalledWith(['tok_used', 'tok_sibling'])
  })

  it('includes the invite email in the audit after-value', async () => {
    await acceptHandler({ data: { inviteId: 'invite_1' } })

    const auditCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.invite.accepted'
    )
    const after = (auditCall![0] as { after: { email: string } }).after
    expect(after.email).toBe(PENDING_INVITE.email)
  })
})

// ---------------------------------------------------------------------------
// Fix #5 — acceptPortalInviteFn must require emailVerified
// ---------------------------------------------------------------------------

describe('acceptPortalInviteFn — emailVerified gate (security)', () => {
  it('returns email_not_verified when session emailVerified=false', async () => {
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1', userId: SESSION_USER.id },
      user: { ...SESSION_USER, emailVerified: false },
    })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect((result as { status: string }).status).toBe('email_not_verified')
  })

  it('does NOT update the invite when emailVerified=false', async () => {
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1', userId: SESSION_USER.id },
      user: { ...SESSION_USER, emailVerified: false },
    })

    await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('does NOT record an audit event when emailVerified=false', async () => {
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1', userId: SESSION_USER.id },
      user: { ...SESSION_USER, emailVerified: false },
    })

    await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('SECURITY: attacker scenario — pre-registered victim email (unverified) + invite to that email → email_not_verified, audit clean', async () => {
    // Attacker pre-registered victim@example.com via password auth (unverified).
    // Admin sends a portal invite to victim@example.com.
    // Attacker receives the invite link (forwarded) and hits it in their session.
    // Result: email_not_verified — invite stays pending, audit log un-polluted.
    const ATTACKER_INVITE = { ...PENDING_INVITE, email: 'victim@example.com' }
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(ATTACKER_INVITE)
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_attacker', userId: 'user_attacker' },
      user: {
        ...SESSION_USER,
        id: 'user_attacker',
        email: 'victim@example.com', // matches invite — same address, pre-registered
        emailVerified: false, // not verified yet
      },
    })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })

    expect((result as { status: string }).status).toBe('email_not_verified')
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('accepts normally when emailVerified=true', async () => {
    // Default SESSION_USER has emailVerified: true
    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    const r = result as { status: string; alreadyAccepted: boolean }
    expect(r.status).toBe('accepted')
    expect(r.alreadyAccepted).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// TOCTOU — concurrent state mutation between read and write
// ---------------------------------------------------------------------------

describe('acceptPortalInviteFn — TOCTOU concurrent state', () => {
  // The accept path reads the invite, validates status/email/expiry, then
  // UPDATEs. A concurrent accept, cancel, or expiry sweep can mutate the
  // row between read and write. The UPDATE must serialize the final state
  // mutation via its WHERE clause + RETURNING — zero affected rows triggers
  // a re-read so we report the actual terminal state, never overwrite a
  // canceled/expired/already-accepted row, and never emit a duplicate
  // 'portal.invite.accepted' audit event.

  it('does NOT emit accepted audit when UPDATE affects zero rows (concurrent accept won)', async () => {
    // Initial read sees pending (default). A concurrent caller wins the
    // accept race — our UPDATE WHERE status='pending' matches zero rows.
    // Re-read shows the row is now 'accepted'. Return alreadyAccepted=true
    // with NO new audit event.
    hoisted.mockDbUpdateReturning.mockResolvedValueOnce([])
    // Re-read after UPDATE returns 0 rows — the row is now accepted.
    hoisted.mockDbQuery.invitation.findFirst
      .mockResolvedValueOnce(PENDING_INVITE) // initial read
      .mockResolvedValueOnce({ ...PENDING_INVITE, status: 'accepted' }) // re-read

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    const r = result as { status: string; alreadyAccepted: boolean }
    expect(r.status).toBe('accepted')
    expect(r.alreadyAccepted).toBe(true)
    // CRITICAL: no second audit event for the same accepted invite.
    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('returns canceled when zero-row UPDATE + re-read shows canceled', async () => {
    // Admin canceled the invite between our read and our write. The UPDATE
    // doesn't match (status was flipped to 'canceled'). Re-read confirms.
    hoisted.mockDbUpdateReturning.mockResolvedValueOnce([])
    hoisted.mockDbQuery.invitation.findFirst
      .mockResolvedValueOnce(PENDING_INVITE)
      .mockResolvedValueOnce({ ...PENDING_INVITE, status: 'canceled' })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect((result as { status: string }).status).toBe('canceled')
    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('returns expired when zero-row UPDATE + re-read shows past expiresAt', async () => {
    // The expiry sweep ran between read and write — or the invite crossed
    // expiresAt at the moment of the UPDATE. The WHERE clause's
    // expires_at > now() rejects the write. Re-read shows past expiresAt.
    hoisted.mockDbUpdateReturning.mockResolvedValueOnce([])
    hoisted.mockDbQuery.invitation.findFirst
      .mockResolvedValueOnce(PENDING_INVITE)
      .mockResolvedValueOnce({ ...PENDING_INVITE, expiresAt: PAST })

    const result = await acceptHandler({ data: { inviteId: 'invite_1' } })
    expect((result as { status: string }).status).toBe('expired')
    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('UPDATE WHERE clause constrains status=pending (atomicity guarantee)', async () => {
    // Pin the SQL contract: the WHERE clause passed to db.update.set.where
    // must include a status='pending' predicate (or equivalent) so it can
    // never overwrite a canceled/accepted row. Inspecting the captured
    // args is the simplest assertion; the real predicate uses `and(...)`.
    await acceptHandler({ data: { inviteId: 'invite_1' } })

    expect(hoisted.mockDbUpdate).toHaveBeenCalledOnce()
    // The mocked `and()` returns its args as an array — flatten + stringify
    // and look for the status='pending' equality.
    const flatten = (v: unknown): string => JSON.stringify(v)
    const allArgs = hoisted.mockDbUpdate.mock.calls.flat().map(flatten).join(' ')
    expect(allArgs).toMatch(/"col":"status".*"val":"pending"/)
  })
})
