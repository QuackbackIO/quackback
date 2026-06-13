/**
 * Unit tests for portal-invite server functions:
 *   sendPortalInviteFn, cancelPortalInviteFn, resendPortalInviteFn,
 *   fetchPortalInvitesFn.
 *
 * All four handlers are captured via the createServerFn mock and exercised
 * directly, following the established pattern in the auth/settings test files.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// createServerFn stub — captures .handler() callbacks in order
// ---------------------------------------------------------------------------

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
type NoArgHandler = () => Promise<unknown>

const handlers: (AnyHandler | NoArgHandler)[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      inputValidator() {
        return chain
      },
      handler(fn: AnyHandler | NoArgHandler) {
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
// Shared hoisted mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbReturning: vi.fn(),
  mockDbSet: vi.fn(),
  mockDbQuery: {
    user: { findFirst: vi.fn() },
    principal: { findFirst: vi.fn() },
    invitation: { findFirst: vi.fn(), findMany: vi.fn() },
  },
  mockSendPortalInviteEmail: vi.fn(),
  mockMintMagicLinkUrl: vi.fn(),
  mockRevokeMagicLinkToken: vi.fn(),
  mockGetEmailSafeUrl: vi.fn(),
  mockGetBaseUrl: vi.fn(),
  mockGenerateId: vi.fn(),
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
    set: (payload: unknown) => {
      hoisted.mockDbSet(payload)
      return {
        where: (...args: unknown[]) => {
          hoisted.mockDbUpdate(...args)
          return { returning: hoisted.mockDbReturning }
        },
      }
    },
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
    isNull: vi.fn((col) => ({ col, isNull: true })),
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

// Dynamic imports used inside handlers
vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  mintMagicLinkUrl: hoisted.mockMintMagicLinkUrl,
  revokeMagicLinkToken: hoisted.mockRevokeMagicLinkToken,
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getEmailSafeUrl: hoisted.mockGetEmailSafeUrl,
}))

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Handler indices in the order portal-invites.ts registers them.
const SEND_IDX = 0
const CANCEL_IDX = 1
const RESEND_IDX = 2
const FETCH_IDX = 3
const GET_LINK_IDX = 4

const ADMIN_AUTH = {
  user: { id: 'user_admin', email: 'admin@acme.com', name: 'Admin' },
  principal: { id: 'principal_admin', role: 'admin', type: 'user' },
  settings: { id: 'ws_1', slug: 'acme', name: 'Acme', logoKey: null },
}

// Load the module once so handlers[] is populated
let sendHandler: AnyHandler
let cancelHandler: AnyHandler
let resendHandler: AnyHandler
let fetchHandler: NoArgHandler
let getLinkHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()

  if (handlers.length === 0) {
    await import('../portal-invites')
  }

  sendHandler = handlers[SEND_IDX] as AnyHandler
  cancelHandler = handlers[CANCEL_IDX] as AnyHandler
  resendHandler = handlers[RESEND_IDX] as AnyHandler
  fetchHandler = handlers[FETCH_IDX] as NoArgHandler
  getLinkHandler = handlers[GET_LINK_IDX] as AnyHandler

  // Sensible defaults
  hoisted.mockRequireAuth.mockResolvedValue(ADMIN_AUTH)
  hoisted.mockGetBaseUrl.mockReturnValue('https://acme.example.com')
  hoisted.mockMintMagicLinkUrl.mockResolvedValue({
    url: 'https://acme.example.com/verify-magic-link?token=abc',
    token: 'tok_new',
  })
  hoisted.mockRevokeMagicLinkToken.mockResolvedValue(undefined)
  hoisted.mockGetEmailSafeUrl.mockReturnValue(null)
  hoisted.mockSendPortalInviteEmail.mockResolvedValue({ sent: false })
  hoisted.mockGenerateId.mockReturnValue('invite_test')
  hoisted.mockDbInsert.mockResolvedValue(undefined)
  hoisted.mockDbUpdate.mockResolvedValue(undefined)
  hoisted.mockDbSet.mockReturnValue(undefined)
  // Default for .returning(): one row affected (normal path)
  hoisted.mockDbReturning.mockResolvedValue([{ id: 'invite_1' }])

  // Default: no existing user/invite
  hoisted.mockDbQuery.user.findFirst.mockResolvedValue(null)
  hoisted.mockDbQuery.principal.findFirst.mockResolvedValue(null)
  hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(null)
  hoisted.mockDbQuery.invitation.findMany.mockResolvedValue([])
  hoisted.mockRecordAuditEvent.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// sendPortalInviteFn
// ---------------------------------------------------------------------------

describe('sendPortalInviteFn — auth gate', () => {
  it('rejects non-admin callers', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('Access denied: Requires [admin]'))
    await expect(sendHandler({ data: { emails: ['user@example.com'] } })).rejects.toThrow(
      'Access denied'
    )
  })
})

describe('sendPortalInviteFn — validation (per-email, single)', () => {
  it('returns ok:false when email belongs to a team member (admin)', async () => {
    hoisted.mockDbQuery.user.findFirst.mockResolvedValue({ id: 'user_1' })
    hoisted.mockDbQuery.principal.findFirst.mockResolvedValue({ role: 'admin' })

    const result = await sendHandler({ data: { emails: ['admin@acme.com'] } })
    const r = result as { results: Array<{ email: string; ok: boolean; error?: string }> }
    expect(r.results[0]).toMatchObject({ email: 'admin@acme.com', ok: false })
    expect(r.results[0].error).toMatch(/already a team member/)
  })

  it('returns ok:false when email belongs to a team member (member)', async () => {
    hoisted.mockDbQuery.user.findFirst.mockResolvedValue({ id: 'user_1' })
    hoisted.mockDbQuery.principal.findFirst.mockResolvedValue({ role: 'member' })

    const result = await sendHandler({ data: { emails: ['member@acme.com'] } })
    const r = result as { results: Array<{ email: string; ok: boolean; error?: string }> }
    expect(r.results[0]).toMatchObject({ email: 'member@acme.com', ok: false })
    expect(r.results[0].error).toMatch(/already a team member/)
  })

  it('allows invite when user exists as role=user (portal user)', async () => {
    hoisted.mockDbQuery.user.findFirst.mockResolvedValue({ id: 'user_1' })
    hoisted.mockDbQuery.principal.findFirst.mockResolvedValue({ role: 'user' })

    const result = await sendHandler({ data: { emails: ['portaluser@example.com'] } })
    const r = result as { results: Array<{ email: string; ok: boolean; inviteId?: string }> }
    expect(r.results[0]).toMatchObject({ email: 'portaluser@example.com', ok: true })
    expect(r.results[0].inviteId).toBe('invite_test')
  })

  it('returns ok:false when a pending portal invite already exists', async () => {
    hoisted.mockDbQuery.user.findFirst.mockResolvedValue(null)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_existing',
      status: 'pending',
      kind: 'portal',
    })

    const result = await sendHandler({ data: { emails: ['someone@example.com'] } })
    const r = result as { results: Array<{ email: string; ok: boolean; error?: string }> }
    expect(r.results[0]).toMatchObject({ email: 'someone@example.com', ok: false })
    expect(r.results[0].error).toMatch(/pending portal invitation has already been sent/)
  })
})

describe('sendPortalInviteFn — success (single)', () => {
  it('inserts a row with kind=portal and status=pending', async () => {
    await sendHandler({ data: { emails: ['newuser@example.com'] } })

    const insertCall = hoisted.mockDbInsert.mock.calls[0][0] as Record<string, unknown>
    expect(insertCall.kind).toBe('portal')
    expect(insertCall.status).toBe('pending')
    expect(insertCall.role).toBeNull()
    expect(insertCall.email).toBe('newuser@example.com')
    expect(insertCall.inviterId).toBe(ADMIN_AUTH.user.id)
  })

  it('normalizes the email to lowercase', async () => {
    await sendHandler({ data: { emails: ['MixedCase@EXAMPLE.COM'] } })

    const insertCall = hoisted.mockDbInsert.mock.calls[0][0] as Record<string, unknown>
    expect(insertCall.email).toBe('mixedcase@example.com')
  })

  it('calls sendPortalInviteEmail with the magic link', async () => {
    hoisted.mockSendPortalInviteEmail.mockResolvedValue({ sent: true })

    await sendHandler({ data: { emails: ['invitee@example.com'] } })

    expect(hoisted.mockSendPortalInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'invitee@example.com',
        workspaceName: ADMIN_AUTH.settings.name,
      })
    )
  })

  it('mints a link that lives as long as the invite (30 days), not the 10-minute sign-in default', async () => {
    await sendHandler({ data: { emails: ['invitee@example.com'] } })

    const opts = hoisted.mockMintMagicLinkUrl.mock.calls[0][0] as { expiresInSeconds?: number }
    expect(opts.expiresInSeconds).toBe(30 * 24 * 60 * 60) // 30-day invite lifetime, not the 10-min sign-in default
  })

  it('persists the magic-link token on the invite row so cancel can revoke it', async () => {
    await sendHandler({ data: { emails: ['invitee@example.com'] } })

    const insertCall = hoisted.mockDbInsert.mock.calls[0][0] as Record<string, unknown>
    expect(insertCall.magicLinkToken).toBe('tok_new')
  })

  it('records a portal.invite.sent audit event', async () => {
    await sendHandler({ data: { emails: ['invitee@example.com'] } })

    const auditCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.invite.sent'
    )
    expect(auditCall).toBeDefined()
  })

  it('returns results array with ok:true and inviteId', async () => {
    const result = await sendHandler({ data: { emails: ['invitee@example.com'] } })
    const r = result as { results: Array<{ email: string; ok: boolean; inviteId?: string }> }
    expect(r.results[0]).toMatchObject({ email: 'invitee@example.com', ok: true })
    expect(r.results[0].inviteId).toBe('invite_test')
  })
})

// ---------------------------------------------------------------------------
// sendPortalInviteFn — bulk
// ---------------------------------------------------------------------------

describe('sendPortalInviteFn — bulk', () => {
  it('accepts an array of emails and returns per-email results', async () => {
    const result = await sendHandler({ data: { emails: ['a@acme.com', 'b@acme.com'] } })
    const r = result as { results: Array<{ email: string; ok: boolean }> }
    expect(r.results).toHaveLength(2)
    expect(r.results[0]).toMatchObject({ email: 'a@acme.com', ok: true })
    expect(r.results[1]).toMatchObject({ email: 'b@acme.com', ok: true })
  })

  it('returns per-email failures without failing the whole batch', async () => {
    // b@acme.com has a pending invite; a@acme.com is clean
    hoisted.mockDbQuery.invitation.findFirst
      .mockResolvedValueOnce(null) // a@acme.com: no pending invite
      .mockResolvedValueOnce({
        id: 'invite_existing',
        status: 'pending',
        kind: 'portal',
      }) // b@acme.com: has pending invite
    hoisted.mockDbQuery.user.findFirst.mockResolvedValue(null)

    const result = await sendHandler({ data: { emails: ['a@acme.com', 'b@acme.com'] } })
    const r = result as {
      results: Array<{ email: string; ok: boolean; error?: string }>
    }
    expect(r.results[0]).toMatchObject({ email: 'a@acme.com', ok: true })
    expect(r.results[1]).toMatchObject({ email: 'b@acme.com', ok: false })
    expect(r.results[1].error).toMatch(/pending/)
  })

  it('rejects when the bulk size exceeds the cap', async () => {
    const emails = Array.from({ length: 51 }, (_, i) => `u${i}@acme.com`)
    await expect(sendHandler({ data: { emails } })).rejects.toThrow(/at most 50/i)
  })

  it('passes the optional message through to sendPortalInviteEmail', async () => {
    await sendHandler({ data: { emails: ['a@acme.com'], message: 'Welcome!' } })
    expect(hoisted.mockSendPortalInviteEmail).toHaveBeenCalledWith(
      expect.objectContaining({ personalMessage: 'Welcome!' })
    )
  })
})

// ---------------------------------------------------------------------------
// getPortalInviteLinkFn
// ---------------------------------------------------------------------------

describe('getPortalInviteLinkFn', () => {
  it('mints a fresh magic-link URL for a pending portal invite', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_abc',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    })
    hoisted.mockMintMagicLinkUrl.mockResolvedValue({
      url: 'https://acme.example.com/verify-magic-link?token=xyz',
      token: 'tok_xyz',
    })

    const result = await getLinkHandler({ data: { inviteId: 'invite_abc' } })
    const r = result as { inviteLink: string; expiresAt: Date }
    expect(r.inviteLink).toMatch(/verify-magic-link/)
    expect(r.expiresAt).toBeInstanceOf(Date)
  })

  it("caps the copy-link token at the invite's remaining lifetime so it can't outlive the invite", async () => {
    // Invite was created earlier and expires in ~3 days; copy-link must mint a
    // token that dies with the invite, not a fresh full-lifetime one.
    const threeDaysSeconds = 3 * 24 * 60 * 60
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_abc',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: new Date(Date.now() + threeDaysSeconds * 1000),
      magicLinkToken: 'tok_old',
    })

    await getLinkHandler({ data: { inviteId: 'invite_abc' } })

    const opts = hoisted.mockMintMagicLinkUrl.mock.calls[0][0] as { expiresInSeconds?: number }
    // Allow a few seconds of slack for execution time.
    expect(opts.expiresInSeconds).toBeGreaterThan(threeDaysSeconds - 60)
    expect(opts.expiresInSeconds).toBeLessThanOrEqual(threeDaysSeconds)
    // And the prior token is revoked.
    expect(hoisted.mockRevokeMagicLinkToken).toHaveBeenCalledWith('tok_old')
  })

  it('rejects for a non-portal invite kind (returns null from DB)', async () => {
    // findFirst returns null because kind='team' is filtered out in the WHERE clause
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(null)
    await expect(getLinkHandler({ data: { inviteId: 'invite_team' } })).rejects.toThrow(
      'PORTAL_INVITE_NOT_FOUND'
    )
  })

  it('rejects for a non-pending invite', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_accepted',
      kind: 'portal',
      status: 'accepted',
      email: 'user@example.com',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    })
    await expect(getLinkHandler({ data: { inviteId: 'invite_accepted' } })).rejects.toThrow()
  })

  it('emits portal.invite.link_minted audit on success', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_abc',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    })
    hoisted.mockMintMagicLinkUrl.mockResolvedValue(
      'https://acme.example.com/verify-magic-link?token=xyz'
    )

    await getLinkHandler({ data: { inviteId: 'invite_abc' } })
    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'portal.invite.link_minted' })
    )
  })

  it('rejects non-admin callers', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('Access denied: Requires [admin]'))
    await expect(getLinkHandler({ data: { inviteId: 'invite_abc' } })).rejects.toThrow(
      'Access denied'
    )
  })
})

// ---------------------------------------------------------------------------
// cancelPortalInviteFn
// ---------------------------------------------------------------------------

describe('cancelPortalInviteFn — auth gate', () => {
  it('rejects non-admin callers', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(cancelHandler({ data: { inviteId: 'invite_1' } })).rejects.toThrow('Access denied')
  })
})

describe('cancelPortalInviteFn — validation', () => {
  it('throws when invite is not found', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(null)

    await expect(cancelHandler({ data: { inviteId: 'invite_missing' } })).rejects.toThrow(
      'not found'
    )
  })

  it('throws when invite is already accepted (non-pending)', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'accepted',
      email: 'user@example.com',
    })

    await expect(cancelHandler({ data: { inviteId: 'invite_1' } })).rejects.toThrow('already')
  })

  it('throws when kind is not portal (wrong kind guard)', async () => {
    // findFirst returns null because query includes kind='portal' filter in the handler
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(null)

    await expect(cancelHandler({ data: { inviteId: 'invite_team_1' } })).rejects.toThrow(
      'not found'
    )
  })
})

describe('cancelPortalInviteFn — success', () => {
  it('updates status to canceled', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
    })

    await cancelHandler({ data: { inviteId: 'invite_1' } })

    expect(hoisted.mockDbUpdate).toHaveBeenCalled()
  })

  it('records a portal.invite.revoked audit event', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
    })

    await cancelHandler({ data: { inviteId: 'invite_1' } })

    const auditCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.invite.revoked'
    )
    expect(auditCall).toBeDefined()
  })

  it('revokes the token live at cancel time (from the UPDATE), not a stale earlier read', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      magicLinkToken: 'tok_stale',
    })
    // The cancel UPDATE returns the token actually on the row at that instant —
    // a concurrent rotation may have changed it since the read above.
    hoisted.mockDbReturning.mockResolvedValue([{ id: 'invite_1', magicLinkToken: 'tok_live' }])

    await cancelHandler({ data: { inviteId: 'invite_1' } })

    expect(hoisted.mockRevokeMagicLinkToken).toHaveBeenCalledWith('tok_live')
    expect(hoisted.mockRevokeMagicLinkToken).not.toHaveBeenCalledWith('tok_stale')
  })
})

// ---------------------------------------------------------------------------
// resendPortalInviteFn
// ---------------------------------------------------------------------------

describe('resendPortalInviteFn — validation', () => {
  it('throws when invite is not found or not pending', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(null)

    await expect(resendHandler({ data: { inviteId: 'invite_gone' } })).rejects.toThrow(
      'not found or is not pending'
    )
  })

  it('throws when invite is expired', async () => {
    const pastDate = new Date(Date.now() - 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: pastDate,
    })

    await expect(resendHandler({ data: { inviteId: 'invite_1' } })).rejects.toThrow('expired')
  })
})

describe('resendPortalInviteFn — success', () => {
  it('mints a new magic link and sends the email', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: futureDate,
    })
    hoisted.mockSendPortalInviteEmail.mockResolvedValue({ sent: true })

    const result = await resendHandler({ data: { inviteId: 'invite_1' } })

    expect(hoisted.mockMintMagicLinkUrl).toHaveBeenCalled()
    expect(hoisted.mockSendPortalInviteEmail).toHaveBeenCalled()
    expect((result as { inviteId: string }).inviteId).toBe('invite_1')
  })

  it('revokes the prior token and records the new one so cancel revokes the live link', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: futureDate,
      magicLinkToken: 'tok_old',
    })

    await resendHandler({ data: { inviteId: 'invite_1' } })

    expect(hoisted.mockRevokeMagicLinkToken).toHaveBeenCalledWith('tok_old')
    const tokenWrite = hoisted.mockDbSet.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).magicLinkToken !== undefined
    )
    expect(tokenWrite?.[0]).toMatchObject({ magicLinkToken: 'tok_new' })
  })

  it('preserves the existing link when the email send fails (drops the orphan token)', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: futureDate,
      magicLinkToken: 'tok_old',
    })
    hoisted.mockSendPortalInviteEmail.mockRejectedValue(new Error('smtp down'))

    await expect(resendHandler({ data: { inviteId: 'invite_1' } })).rejects.toThrow('smtp down')

    // The just-minted token is revoked (orphan cleanup) and the invitee's
    // existing token is NOT revoked, so their current link still works.
    expect(hoisted.mockRevokeMagicLinkToken).toHaveBeenCalledWith('tok_new')
    expect(hoisted.mockRevokeMagicLinkToken).not.toHaveBeenCalledWith('tok_old')
    // And the new token is never recorded on the row.
    const tokenWrite = hoisted.mockDbSet.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>).magicLinkToken !== undefined
    )
    expect(tokenWrite).toBeUndefined()
  })

  it('emits portal.invite.resent (not portal.invite.sent) on resend', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: futureDate,
    })

    await resendHandler({ data: { inviteId: 'invite_1' } })

    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'portal.invite.resent' })
    )
    // The old portal.invite.sent event must NOT be emitted during a resend
    const sentEvent = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.invite.sent'
    )
    expect(sentEvent).toBeUndefined()
  })
})

describe('resendPortalInviteFn — TOCTOU resilience', () => {
  // The resend path reads the invite + sends a fresh magic link, then
  // UPDATEs lastSentAt + expiresAt. A concurrent accept / cancel / sweep
  // could flip the row to a terminal state between the SELECT and the
  // UPDATE. Without a status='pending' predicate, the expiry extension
  // would silently bring an accepted/canceled/expired row back into
  // 'has a fresh deadline' territory and emit a misleading audit event.
  // The expiresAt > now() predicate covers the second race: an invite
  // that read as in-date but expired during the email-send window
  // must not be silently rescued by the expiry-extension.

  it('UPDATE WHERE pins both status=pending AND expiresAt > now()', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: futureDate,
    })
    hoisted.mockSendPortalInviteEmail.mockResolvedValue({ sent: true })

    await resendHandler({ data: { inviteId: 'invite_1' } })

    // mockDbUpdate captures the args passed to .where(). The handler builds
    // its predicate via and(...), and our `and` mock returns its args as an
    // array. So calls[0][0] is the array of predicate objects.
    expect(hoisted.mockDbUpdate).toHaveBeenCalled()
    const whereArgs = hoisted.mockDbUpdate.mock.calls[0][0] as Array<{
      col: string
      val: unknown
    }>
    // status=pending predicate
    expect(whereArgs).toContainEqual(expect.objectContaining({ col: 'status', val: 'pending' }))
    // expires_at > now() predicate (regression: ensures the expiry race
    // can never silently rescue an invite that expired mid-flight)
    const expiresAtPredicate = whereArgs.find((p) => p.col === 'expiresAt')
    expect(expiresAtPredicate, 'resend UPDATE must pin expiresAt > now()').toBeDefined()
    expect(expiresAtPredicate!.val).toBeInstanceOf(Date)
  })

  it('throws when the UPDATE affects zero rows (lost the race)', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: futureDate,
    })
    hoisted.mockSendPortalInviteEmail.mockResolvedValue({ sent: true })
    // Simulate: status flipped to 'accepted' between SELECT and UPDATE.
    // The UPDATE's status='pending' predicate matches no rows.
    hoisted.mockDbReturning.mockResolvedValueOnce([])

    await expect(resendHandler({ data: { inviteId: 'invite_1' } })).rejects.toThrow(
      'no longer pending'
    )
  })

  it('does NOT emit portal.invite.resent on the lost-race path', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: futureDate,
    })
    hoisted.mockSendPortalInviteEmail.mockResolvedValue({ sent: true })
    hoisted.mockDbReturning.mockResolvedValueOnce([])

    await expect(resendHandler({ data: { inviteId: 'invite_1' } })).rejects.toThrow()

    const resentEvent = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.invite.resent'
    )
    expect(resentEvent).toBeUndefined()
  })

  it('does NOT send a new email when the UPDATE loses the race (G8)', async () => {
    // Regression: the resend path used to mint+send the magic link BEFORE
    // running its TOCTOU-guarded UPDATE. A concurrent accept/cancel
    // during the SMTP window meant the admin saw an error while the
    // invitee already had a working magic link in their inbox — pointing
    // at a row the server now considers terminal. The fix flips the
    // ordering: claim the slot (UPDATE with status=pending + expiresAt
    // guards) FIRST; mint+send only on a successful claim.
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: futureDate,
    })
    hoisted.mockSendPortalInviteEmail.mockResolvedValue({ sent: true })
    // Lost the race — UPDATE matches no rows.
    hoisted.mockDbReturning.mockResolvedValueOnce([])

    await expect(resendHandler({ data: { inviteId: 'invite_1' } })).rejects.toThrow()

    // The invitee must not receive a stale magic-link email.
    expect(hoisted.mockSendPortalInviteEmail).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 1F — batchId correlation + hasMessage PII guard
// ---------------------------------------------------------------------------

describe('sendPortalInviteFn — batchId and hasMessage (1F)', () => {
  it('emits N portal.invite.sent rows with the same batchId for a bulk call', async () => {
    await sendHandler({ data: { emails: ['a@x.com', 'b@x.com', 'c@x.com'] } })
    const calls = hoisted.mockRecordAuditEvent.mock.calls.filter(
      (c) => (c[0] as { event: string }).event === 'portal.invite.sent'
    )
    expect(calls).toHaveLength(3)
    const batchIds = calls.map(
      (c) => (c[0] as { metadata?: { batchId?: string } }).metadata?.batchId
    )
    expect(new Set(batchIds).size).toBe(1)
    expect(batchIds[0]).toMatch(/^batch_/)
  })

  it('omits batchId for a single-email send', async () => {
    await sendHandler({ data: { emails: ['solo@x.com'] } })
    const call = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.invite.sent'
    )
    expect((call?.[0] as { metadata?: { batchId?: string } }).metadata?.batchId).toBeUndefined()
  })

  it('records hasMessage:true without leaking the message body', async () => {
    await sendHandler({ data: { emails: ['m@x.com'], message: 'Hi there!' } })
    const call = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.invite.sent'
    )
    expect((call?.[0] as { metadata?: { hasMessage?: boolean } }).metadata?.hasMessage).toBe(true)
    expect(JSON.stringify((call?.[0] as { metadata?: unknown }).metadata)).not.toContain('Hi there')
  })
})

// ---------------------------------------------------------------------------
// fetchPortalInvitesFn
// ---------------------------------------------------------------------------

describe('fetchPortalInvitesFn', () => {
  it('rejects non-admin callers', async () => {
    hoisted.mockRequireAuth.mockRejectedValue(new Error('Access denied'))
    await expect((fetchHandler as () => Promise<unknown>)()).rejects.toThrow('Access denied')
  })

  it('returns only kind=portal rows (findMany is called)', async () => {
    const mockRows = [
      {
        id: 'invite_1',
        email: 'a@example.com',
        status: 'pending',
        kind: 'portal',
        createdAt: new Date('2026-05-01'),
        lastSentAt: new Date('2026-05-01'),
        expiresAt: new Date('2026-05-15'),
      },
    ]
    hoisted.mockDbQuery.invitation.findMany.mockResolvedValue(mockRows)

    const result = await (fetchHandler as () => Promise<unknown>)()
    const items = result as { id: string; kind: string }[]

    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('invite_1')
    expect(items[0].kind).toBe('portal')
  })

  it('serializes dates to ISO strings', async () => {
    const date = new Date('2026-05-01T12:00:00.000Z')
    hoisted.mockDbQuery.invitation.findMany.mockResolvedValue([
      {
        id: 'invite_1',
        email: 'a@example.com',
        status: 'pending',
        kind: 'portal',
        createdAt: date,
        lastSentAt: date,
        expiresAt: date,
      },
    ])

    const result = await (fetchHandler as () => Promise<unknown>)()
    const item = (result as { createdAt: string }[])[0]

    expect(item.createdAt).toBe('2026-05-01T12:00:00.000Z')
  })

  it('returns empty array when no portal invites exist', async () => {
    hoisted.mockDbQuery.invitation.findMany.mockResolvedValue([])

    const result = await (fetchHandler as () => Promise<unknown>)()
    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Fix #7 — sendPortalInviteFn dup-pending check must ignore expired
// ---------------------------------------------------------------------------

describe('sendPortalInviteFn — expired pending invite is not a blocker', () => {
  it('succeeds when the only existing pending invite is past its expiresAt', async () => {
    // The duplicate-check query (with the gt(expiresAt, now) filter) returns
    // null because the stale row is excluded — the findFirst mock simulates this.
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(null)

    const result = await sendHandler({ data: { emails: ['returning@example.com'] } })
    const r = result as { results: Array<{ email: string; ok: boolean; inviteId?: string }> }
    expect(r.results[0]).toMatchObject({ email: 'returning@example.com', ok: true })
    expect(r.results[0].inviteId).toBe('invite_test')
  })

  it('still blocks (per-email failure) when a non-expired pending invite exists', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_active',
      status: 'pending',
      kind: 'portal',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    const result = await sendHandler({ data: { emails: ['someone@example.com'] } })
    const r = result as { results: Array<{ email: string; ok: boolean; error?: string }> }
    expect(r.results[0]).toMatchObject({ email: 'someone@example.com', ok: false })
    expect(r.results[0].error).toMatch(/pending portal invitation has already been sent/)
  })
})

// ---------------------------------------------------------------------------
// Fix #8 — cancelPortalInviteFn race guard (concurrent accept)
// ---------------------------------------------------------------------------

describe('cancelPortalInviteFn — race guard', () => {
  const PENDING_INV = {
    id: 'invite_1',
    kind: 'portal',
    status: 'pending',
    email: 'user@example.com',
  }

  it('returns no_op_already_accepted when the UPDATE affects 0 rows', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(PENDING_INV)
    // Simulate: row was concurrently accepted — WHERE status='pending' matches nothing.
    hoisted.mockDbReturning.mockResolvedValue([])

    const result = await cancelHandler({ data: { inviteId: 'invite_1' } })
    expect((result as { status: string }).status).toBe('no_op_already_accepted')
  })

  it('does NOT record an audit event on race no-op', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(PENDING_INV)
    hoisted.mockDbReturning.mockResolvedValue([])

    await cancelHandler({ data: { inviteId: 'invite_1' } })
    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('returns status=canceled and records audit when UPDATE affects 1 row (normal path)', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(PENDING_INV)
    hoisted.mockDbReturning.mockResolvedValue([{ id: 'invite_1' }])

    const result = await cancelHandler({ data: { inviteId: 'invite_1' } })
    expect((result as { status: string }).status).toBe('canceled')

    const auditCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => (c[0] as { event: string }).event === 'portal.invite.revoked'
    )
    expect(auditCall).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Fix #9 — resendPortalInviteFn must extend expiresAt
// ---------------------------------------------------------------------------

describe('resendPortalInviteFn — extends expiresAt', () => {
  it('sets expiresAt to ~30 days from now on resend', async () => {
    const nearExpiry = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours left
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: nearExpiry,
    })

    const before = Date.now()
    await resendHandler({ data: { inviteId: 'invite_1' } })
    const after = Date.now()

    expect(hoisted.mockDbSet).toHaveBeenCalled()
    const setPayload = hoisted.mockDbSet.mock.calls[0][0] as {
      lastSentAt: Date
      expiresAt: Date
    }

    // expiresAt must be ~30 days from the time of resend, not the old near-expiry.
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    const expiresAtMs = setPayload.expiresAt.getTime()
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS - 5000)
    expect(expiresAtMs).toBeLessThanOrEqual(after + THIRTY_DAYS_MS + 5000)
  })

  it('also updates lastSentAt on resend', async () => {
    const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      id: 'invite_1',
      kind: 'portal',
      status: 'pending',
      email: 'user@example.com',
      expiresAt: futureDate,
    })

    const before = Date.now()
    await resendHandler({ data: { inviteId: 'invite_1' } })
    const after = Date.now()

    const setPayload = hoisted.mockDbSet.mock.calls[0][0] as { lastSentAt: Date }
    expect(setPayload.lastSentAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(setPayload.lastSentAt.getTime()).toBeLessThanOrEqual(after + 100)
  })
})

// ---------------------------------------------------------------------------
// sendPortalInviteFn — empty emails array (handler-level)
// ---------------------------------------------------------------------------

describe('sendPortalInviteFn — empty emails array (handler-level)', () => {
  it('returns an empty result set for an empty emails array (handler-level)', async () => {
    // Bypasses the Zod .min(1) (test harness mocks createServerFn validation).
    // Confirms the handler degrades gracefully — no per-email work, no audit emits.
    const result = await sendHandler({ data: { emails: [] } })
    expect((result as { results: unknown[] }).results).toEqual([])
    expect(hoisted.mockSendPortalInviteEmail).not.toHaveBeenCalled()
  })
})
