/**
 * Unit tests for acceptInvitationFn (team invites).
 *
 * Covers the hardened acceptance flow: every rejection (expired, email
 * mismatch, terminal states) is validated BEFORE the invite is claimed, the
 * claim and its principal/user side effects commit atomically in one
 * transaction, and a failed acceptance can never reopen an invite to
 * 'pending' or leave a claimed invite with missing side effects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// createServerFn stub
// ---------------------------------------------------------------------------

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

// Handlers register in file-definition order:
// getDetails=0, accept=1, setPassword=2, getBranding=3
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

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const hoisted = vi.hoisted(() => {
  /** Every UPDATE issued through the live db or the tx, in call order. */
  const updates: Array<{
    source: 'db' | 'tx'
    table: unknown
    values: Record<string, unknown>
    where: unknown
  }> = []
  const mockClaimReturning = vi.fn<() => Promise<unknown[]>>()
  const makeUpdate = (source: 'db' | 'tx') => (table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (where: unknown) => {
        updates.push({ source, table, values, where })
        return { returning: () => mockClaimReturning() }
      },
    }),
  })
  const mockDbQuery = {
    invitation: { findFirst: vi.fn() },
    principal: { findFirst: vi.fn() },
    settings: { findFirst: vi.fn() },
  }
  const mockTxQuery = {
    invitation: { findFirst: vi.fn() },
    principal: { findFirst: vi.fn() },
  }
  const tx = { update: makeUpdate('tx'), query: mockTxQuery }
  const mockTransaction = vi.fn()
  return {
    updates,
    mockClaimReturning,
    makeUpdate,
    mockDbQuery,
    mockTxQuery,
    tx,
    mockTransaction,
    mockGetSession: vi.fn(),
    mockCreatePrincipal: vi.fn(),
    mockSetPrincipalRole: vi.fn(),
    mockSyncPrincipalProfileById: vi.fn(),
    mockRevokeMagicLinkTokens: vi.fn(),
    mockCacheDel: vi.fn(),
  }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    query: hoisted.mockDbQuery,
    update: hoisted.makeUpdate('db'),
    transaction: hoisted.mockTransaction,
  },
  invitation: {
    id: 'invitation.id',
    status: 'invitation.status',
    kind: 'invitation.kind',
    email: 'invitation.email',
    expiresAt: 'invitation.expiresAt',
  },
  principal: { userId: 'principal.userId', id: 'principal.id' },
  user: { id: 'user.id', name: 'user.name' },
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
}))

vi.mock('@/lib/server/auth/session', () => ({
  getSession: hoisted.mockGetSession,
}))

vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  createPrincipal: hoisted.mockCreatePrincipal,
  setPrincipalRole: hoisted.mockSetPrincipalRole,
  syncPrincipalProfileById: hoisted.mockSyncPrincipalProfileById,
}))

vi.mock('@/lib/server/auth/magic-link-mint', () => ({
  revokeMagicLinkTokens: hoisted.mockRevokeMagicLinkTokens,
}))

vi.mock('@/lib/server/storage/s3', () => ({
  getPublicUrlOrNull: () => null,
}))

vi.mock('@/lib/server/redis', () => ({
  cacheDel: hoisted.mockCacheDel,
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACCEPT_IDX = 1

const FUTURE = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
const PAST = new Date(Date.now() - 1000)

const SESSION_USER = {
  id: 'user_1',
  email: 'invitee@example.com',
  name: 'Invitee',
  createdAt: new Date().toISOString(),
}

const PENDING_INVITE = {
  id: 'invite_1',
  email: 'invitee@example.com',
  kind: 'team',
  status: 'pending',
  role: 'member',
  expiresAt: FUTURE,
  magicLinkTokens: ['tok_used', 'tok_sibling'],
}

const CLAIMED_ROW = { ...PENDING_INVITE, status: 'accepted' }

/** All updates that wrote the given invitation status value. */
function statusWrites(status: string) {
  return hoisted.updates.filter((u) => u.values.status === status)
}

let acceptHandler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  hoisted.updates.length = 0

  if (handlers.length === 0) {
    await import('../invitations')
  }
  acceptHandler = handlers[ACCEPT_IDX]

  hoisted.mockGetSession.mockResolvedValue({ session: { id: 'sess_1' }, user: SESSION_USER })
  hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(PENDING_INVITE)
  hoisted.mockTxQuery.invitation.findFirst.mockResolvedValue(PENDING_INVITE)
  hoisted.mockTxQuery.principal.findFirst.mockResolvedValue(null)
  hoisted.mockDbQuery.principal.findFirst.mockResolvedValue(null)
  hoisted.mockClaimReturning.mockResolvedValue([CLAIMED_ROW])
  hoisted.mockTransaction.mockImplementation(
    async (fn: (t: typeof hoisted.tx) => Promise<unknown>) => fn(hoisted.tx)
  )
  hoisted.mockCreatePrincipal.mockResolvedValue({ id: 'principal_new' })
  hoisted.mockSetPrincipalRole.mockResolvedValue({ cacheKeysToBust: [] })
  hoisted.mockSyncPrincipalProfileById.mockResolvedValue(undefined)
  hoisted.mockRevokeMagicLinkTokens.mockResolvedValue(undefined)
  hoisted.mockCacheDel.mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('acceptInvitationFn — auth gate', () => {
  it('throws when there is no session and touches nothing', async () => {
    hoisted.mockGetSession.mockResolvedValue(null)

    await expect(acceptHandler({ data: { invitationId: 'invite_1' } })).rejects.toThrow(
      /session has expired/i
    )
    expect(hoisted.updates).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Pre-claim validation — terminal states never mutate status
// ---------------------------------------------------------------------------

describe('acceptInvitationFn — pre-claim validation', () => {
  it('throws not-found without any status write', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue(null)

    await expect(acceptHandler({ data: { invitationId: 'invite_x' } })).rejects.toThrow(
      /could not be found/i
    )
    expect(hoisted.updates).toHaveLength(0)
    expect(hoisted.mockTransaction).not.toHaveBeenCalled()
  })

  it('throws already-accepted without any status write', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'accepted',
    })

    await expect(acceptHandler({ data: { invitationId: 'invite_1' } })).rejects.toThrow(
      /already been accepted/i
    )
    expect(hoisted.updates).toHaveLength(0)
  })

  it('throws cancelled without any status write', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'canceled',
    })

    await expect(acceptHandler({ data: { invitationId: 'invite_1' } })).rejects.toThrow(
      /has been cancelled/i
    )
    expect(hoisted.updates).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Expired invites — marked 'expired', never reopened to 'pending'
// ---------------------------------------------------------------------------

describe('acceptInvitationFn — expired invites', () => {
  it('marks a pending invite past expiresAt as expired (not pending, not accepted)', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      expiresAt: PAST,
    })

    await expect(acceptHandler({ data: { invitationId: 'invite_1' } })).rejects.toThrow(
      /has expired/i
    )

    expect(statusWrites('expired')).toHaveLength(1)
    expect(statusWrites('pending')).toHaveLength(0)
    expect(statusWrites('accepted')).toHaveLength(0)
    expect(hoisted.mockTransaction).not.toHaveBeenCalled()
  })

  it('guards the expired write on status=pending so a concurrent accept is never clobbered', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      expiresAt: PAST,
    })

    await expect(acceptHandler({ data: { invitationId: 'invite_1' } })).rejects.toThrow(
      /has expired/i
    )

    const [write] = statusWrites('expired')
    expect(JSON.stringify(write.where)).toMatch(/"col":"invitation.status".*"val":"pending"/)
  })

  it('leaves an already-expired invite untouched (stays expired)', async () => {
    hoisted.mockDbQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'expired',
      expiresAt: PAST,
    })

    await expect(acceptHandler({ data: { invitationId: 'invite_1' } })).rejects.toThrow(
      /has expired/i
    )
    expect(hoisted.updates).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Email mismatch — validated before the claim, never flips status
// ---------------------------------------------------------------------------

describe('acceptInvitationFn — email mismatch', () => {
  it('rejects a mismatched email without any status write', async () => {
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1' },
      user: { ...SESSION_USER, id: 'user_other', email: 'other@example.com' },
    })

    await expect(acceptHandler({ data: { invitationId: 'invite_1' } })).rejects.toThrow(
      /different email address/i
    )
    expect(hoisted.updates).toHaveLength(0)
    expect(hoisted.mockTransaction).not.toHaveBeenCalled()
    expect(hoisted.mockCreatePrincipal).not.toHaveBeenCalled()
  })

  it('matches emails case-insensitively', async () => {
    hoisted.mockGetSession.mockResolvedValue({
      session: { id: 'sess_1' },
      user: { ...SESSION_USER, email: 'INVITEE@EXAMPLE.COM' },
    })

    const result = await acceptHandler({ data: { invitationId: 'invite_1' } })
    expect((result as { invitationId: string }).invitationId).toBe('invite_1')
  })
})

// ---------------------------------------------------------------------------
// Atomic claim + side effects
// ---------------------------------------------------------------------------

describe('acceptInvitationFn — atomic claim + side effects', () => {
  it('claims the invite inside the transaction', async () => {
    await acceptHandler({ data: { invitationId: 'invite_1' } })

    expect(hoisted.mockTransaction).toHaveBeenCalledOnce()
    const accepted = statusWrites('accepted')
    expect(accepted).toHaveLength(1)
    expect(accepted[0].source).toBe('tx')
    expect(JSON.stringify(accepted[0].where)).toMatch(/"col":"invitation.status".*"val":"pending"/)
  })

  it('creates a new principal through the transaction handle', async () => {
    const result = await acceptHandler({ data: { invitationId: 'invite_1' } })

    expect((result as { invitationId: string }).invitationId).toBe('invite_1')
    expect(hoisted.mockCreatePrincipal).toHaveBeenCalledWith(
      { userId: 'user_1', role: 'member', displayName: null },
      hoisted.tx
    )
  })

  it('upgrades an existing lower-role principal through the transaction handle', async () => {
    hoisted.mockTxQuery.principal.findFirst.mockResolvedValue({ id: 'principal_1', role: 'user' })

    await acceptHandler({ data: { invitationId: 'invite_1' } })

    expect(hoisted.mockSetPrincipalRole).toHaveBeenCalledWith(
      { principalId: 'principal_1' },
      'member',
      expect.objectContaining({ executor: hoisted.tx })
    )
    expect(hoisted.mockCreatePrincipal).not.toHaveBeenCalled()
  })

  it('does not downgrade an existing higher-role principal', async () => {
    hoisted.mockTxQuery.principal.findFirst.mockResolvedValue({ id: 'principal_1', role: 'admin' })

    await acceptHandler({ data: { invitationId: 'invite_1' } })

    expect(hoisted.mockSetPrincipalRole).not.toHaveBeenCalled()
  })

  it('busts the principal cache after the transaction commits', async () => {
    hoisted.mockTxQuery.principal.findFirst.mockResolvedValue({ id: 'principal_1', role: 'user' })
    hoisted.mockSetPrincipalRole.mockResolvedValue({ cacheKeysToBust: ['principal:user:user_1'] })

    await acceptHandler({ data: { invitationId: 'invite_1' } })

    expect(hoisted.mockCacheDel).toHaveBeenCalledWith('principal:user:user_1')
  })

  it('writes the display name to the user row inside the transaction', async () => {
    const { user } = await import('@/lib/server/db')

    await acceptHandler({ data: { invitationId: 'invite_1', name: 'New Name' } })

    expect(hoisted.mockCreatePrincipal).toHaveBeenCalledWith(
      { userId: 'user_1', role: 'member', displayName: 'New Name' },
      hoisted.tx
    )
    const nameWrite = hoisted.updates.find((u) => u.table === user)
    expect(nameWrite).toBeDefined()
    expect(nameWrite!.source).toBe('tx')
    expect(nameWrite!.values).toEqual({ name: 'New Name' })
  })

  it('revokes the claimed magic-link token set after commit', async () => {
    await acceptHandler({ data: { invitationId: 'invite_1' } })

    expect(hoisted.mockRevokeMagicLinkTokens).toHaveBeenCalledWith(['tok_used', 'tok_sibling'])
  })

  it('still accepts when token revocation fails (best-effort cleanup)', async () => {
    hoisted.mockRevokeMagicLinkTokens.mockRejectedValue(new Error('redis down'))

    const result = await acceptHandler({ data: { invitationId: 'invite_1' } })
    expect((result as { invitationId: string }).invitationId).toBe('invite_1')
    expect(statusWrites('pending')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Race + failure semantics
// ---------------------------------------------------------------------------

describe('acceptInvitationFn — race + failure semantics', () => {
  it('reports already-accepted when a concurrent accept wins the claim', async () => {
    hoisted.mockClaimReturning.mockResolvedValue([])
    hoisted.mockTxQuery.invitation.findFirst.mockResolvedValue({
      ...PENDING_INVITE,
      status: 'accepted',
    })

    await expect(acceptHandler({ data: { invitationId: 'invite_1' } })).rejects.toThrow(
      /already been accepted/i
    )
    expect(hoisted.mockCreatePrincipal).not.toHaveBeenCalled()
  })

  it('a failure inside the transaction leaves the invite unclaimed (no pending reset, no revoke)', async () => {
    hoisted.mockCreatePrincipal.mockRejectedValue(new Error('insert failed'))

    await expect(acceptHandler({ data: { invitationId: 'invite_1' } })).rejects.toThrow(
      'insert failed'
    )

    // The transaction rolls the claim back; the handler must not issue any
    // compensating write that could reopen a consumed invite to 'pending'.
    expect(statusWrites('pending')).toHaveLength(0)
    expect(hoisted.mockRevokeMagicLinkTokens).not.toHaveBeenCalled()
    expect(hoisted.mockCacheDel).not.toHaveBeenCalled()
  })
})
