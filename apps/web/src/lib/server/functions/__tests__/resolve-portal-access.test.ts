/**
 * Unit tests for resolvePortalAccessForRequest().
 *
 * This is the shared server-side portal-access resolver that gates every
 * public-portal data server function. The two properties under test:
 *  - no-settings-safe: a missing/unreadable portal config → granted/public.
 *  - private + unauthorized caller → denied.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mock: request headers (anonymous by default) ---

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// --- Mock: createServerFn (capture the wrapper handler, not under test here) ---

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler(fn: unknown) {
        return fn
      },
    }
    return chain
  },
  // resolvePortalAccessForRequest is wrapped in createServerOnlyFn — the
  // mock just returns the inner function so the test can call it directly.
  createServerOnlyFn: <T>(fn: T) => fn,
}))

// --- Mock: auth (dynamic import target) ---

const mockGetSession = vi.fn()

vi.mock('@/lib/server/auth/index', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}))

// --- Mock: db (dynamic import target) ---

const mockPrincipalFindFirst = vi.fn()
const mockInvitationFindFirst = vi.fn()
const mockWidgetOriginSessionFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
      invitation: { findFirst: (...args: unknown[]) => mockInvitationFindFirst(...args) },
      widgetOriginSession: {
        findFirst: (...args: unknown[]) => mockWidgetOriginSessionFindFirst(...args),
      },
    },
  },
  principal: { userId: 'userId', id: 'id' },
  invitation: { email: 'email', kind: 'kind', status: 'status' },
  widgetOriginSession: { sessionId: 'sessionId' },
  eq: vi.fn(),
  and: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn(),
  sql: vi.fn((parts: TemplateStringsArray) => parts.raw[0]),
}))

// --- Mock: settings service (static import target) ---

const mockGetPortalConfig = vi.fn()

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: () => mockGetPortalConfig(),
  updatePortalConfig: vi.fn(),
}))

// --- Mock: widget config (static import target) ---

const mockGetWidgetConfig = vi.fn()

vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: () => mockGetWidgetConfig(),
}))

// --- Mock: audit log (imported by portal-access.ts) ---

vi.mock('@/lib/server/audit/log', () => ({
  actorFromAuth: vi.fn(),
  recordAuditEvent: vi.fn(),
}))

// --- Mock: segment membership service ---

const mockSegmentIdsForPrincipal = vi.fn()

vi.mock('@/lib/server/domains/segments/segment-membership.service', () => ({
  segmentIdsForPrincipal: (...args: unknown[]) => mockSegmentIdsForPrincipal(...args),
}))

import { resolvePortalAccessForRequest } from '../portal-access'
import { NotFoundError } from '@/lib/shared/errors'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no accepted portal invite.
  mockInvitationFindFirst.mockResolvedValue(null)
  // Default: no widget origin marker.
  mockWidgetOriginSessionFindFirst.mockResolvedValue(null)
  // Default: identifyVerification off (email-capture mode).
  mockGetWidgetConfig.mockResolvedValue({ identifyVerification: false })
  // Default: no segment memberships.
  mockSegmentIdsForPrincipal.mockResolvedValue(new Set())
})

describe('resolvePortalAccessForRequest — config-throw contract', () => {
  it('returns granted/public when getPortalConfig throws NotFoundError (no settings row)', async () => {
    mockGetSession.mockResolvedValue(null)
    mockGetPortalConfig.mockRejectedValue(
      new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    )

    const result = await resolvePortalAccessForRequest()

    expect(result).toEqual({ granted: true, reason: 'public' })
  })

  it('fails CLOSED for an anonymous caller when getPortalConfig throws a non-NotFoundError', async () => {
    // Regression: a transient DB / cache error during config read must NOT
    // silently render a private portal as public. Anonymous → unauthenticated.
    mockGetSession.mockResolvedValue(null)
    mockGetPortalConfig.mockRejectedValue(new Error('DATABASE_ERROR'))

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthenticated')
    }
  })

  it('fails CLOSED for an authenticated caller when getPortalConfig throws a non-NotFoundError', async () => {
    // Same regression for an authenticated user — must NOT default to
    // granted/public. Authenticated callers get the unauthorized screen.
    mockGetSession.mockResolvedValue({
      user: { id: 'user_1', email: 'user@acme.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockGetPortalConfig.mockRejectedValue(new Error('DATABASE_ERROR'))

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthorized')
    }
  })

  it('does not throw out of the function on any config error', async () => {
    // Never-throw contract must hold for both branches.
    mockGetSession.mockResolvedValue(null)
    mockGetPortalConfig.mockRejectedValue(new Error('DATABASE_ERROR'))

    await expect(resolvePortalAccessForRequest()).resolves.toBeDefined()
  })
})

describe('resolvePortalAccessForRequest — public portal', () => {
  it('grants an anonymous caller on a public portal', async () => {
    mockGetSession.mockResolvedValue(null)
    mockGetPortalConfig.mockResolvedValue({ access: { visibility: 'public', allowedDomains: [] } })

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(true)
  })

  it('treats an absent access block as a public portal', async () => {
    mockGetSession.mockResolvedValue(null)
    mockGetPortalConfig.mockResolvedValue({})

    const result = await resolvePortalAccessForRequest()

    expect(result).toEqual({ granted: true, reason: 'public' })
  })
})

describe('resolvePortalAccessForRequest — private portal', () => {
  it('denies an anonymous caller on a private portal', async () => {
    mockGetSession.mockResolvedValue(null)
    mockGetPortalConfig.mockResolvedValue({ access: { visibility: 'private', allowedDomains: [] } })

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthenticated')
    }
  })

  it('denies an authenticated non-team caller whose domain is not allowed', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user_1', email: 'outsider@evil.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: ['acme.com'] },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthorized')
    }
  })

  it('grants a team member (admin) on a private portal', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user_admin', email: 'admin@acme.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'admin' })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result).toEqual({ granted: true, reason: 'team' })
  })

  it('grants a verified caller whose email domain is on the allowlist', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user_2', email: 'person@acme.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: ['acme.com'] },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result).toEqual({ granted: true, reason: 'domain' })
  })

  it('denies an anonymous-principal session on a private portal', async () => {
    // An anonymous Better Auth session must not count as authenticated.
    mockGetSession.mockResolvedValue({
      user: { id: 'user_anon', email: 'anon@anon.quackback.io', emailVerified: false },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'anonymous', role: 'user' })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthenticated')
    }
  })

  it('fails CLOSED when the principal DB lookup throws (deny, not throw)', async () => {
    // A DB error during principal resolution must never grant access and must
    // not throw out of the function — the never-throw contract must hold.
    mockGetSession.mockResolvedValue({
      user: { id: 'user_1', email: 'user@acme.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockRejectedValue(new Error('DB_CONN_TIMEOUT'))
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    const result = await resolvePortalAccessForRequest()

    // Must not throw, and must deny — fail CLOSED.
    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthenticated')
    }
  })

  it('fails CLOSED on a public portal when the principal lookup throws (treats session as anonymous)', async () => {
    // Even on a public portal, a DB error during principal lookup should fail
    // closed for team-member detection — but a public portal still grants.
    // The function must not throw.
    mockGetSession.mockResolvedValue({
      user: { id: 'user_1', email: 'user@acme.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockRejectedValue(new Error('DB_CONN_TIMEOUT'))
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'public', allowedDomains: [] },
    })

    await expect(resolvePortalAccessForRequest()).resolves.toMatchObject({ granted: true })
  })
})

describe('resolvePortalAccessForRequest — portal invite grant', () => {
  it('grants reason=invite for a verified caller with an accepted portal invite', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user_inv', email: 'invitee@example.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockInvitationFindFirst.mockResolvedValue({ id: 'invite_1' })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result).toEqual({ granted: true, reason: 'invite' })
  })

  it('denies when no accepted invite exists (invite lookup returns null)', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user_inv', email: 'uninvited@example.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockInvitationFindFirst.mockResolvedValue(null)
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthorized')
    }
  })

  it('fails CLOSED on invite lookup DB error (deny, not throw)', async () => {
    // A DB error during the invite lookup must never grant access.
    mockGetSession.mockResolvedValue({
      user: { id: 'user_inv', email: 'invitee@example.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockInvitationFindFirst.mockRejectedValue(new Error('DB_TIMEOUT'))
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    if (!result.granted) {
      expect(result.reason).toBe('unauthorized')
    }
  })

  it('skips invite lookup when emailVerified=false (unverified email cannot claim invite)', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user_inv', email: 'invitee@example.com', emailVerified: false },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    await resolvePortalAccessForRequest()

    // invite lookup should not have been called
    expect(mockInvitationFindFirst).not.toHaveBeenCalled()
  })

  it('skips invite lookup when caller is unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    await resolvePortalAccessForRequest()

    expect(mockInvitationFindFirst).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Fix #4 — invite lookup must use case-insensitive email comparison
// ---------------------------------------------------------------------------

describe('resolvePortalAccessForRequest — case-insensitive invite lookup', () => {
  it('grants reason=invite when session email is mixed-case but invite is lowercase', async () => {
    // The send path normalizes to lowercase on insert. An OAuth provider may
    // return a mixed-case address stored on the session as-is. The resolver
    // must lowercase before the SQL lookup.
    mockGetSession.mockResolvedValue({
      user: { id: 'user_inv', email: 'Alice@Example.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    // Simulates DB row with lowercase email matching the lowercased session email.
    mockInvitationFindFirst.mockResolvedValue({ id: 'invite_1' })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result).toEqual({ granted: true, reason: 'invite' })
    // The lookup must have been called (not skipped due to emailVerified=true).
    expect(mockInvitationFindFirst).toHaveBeenCalled()
  })

  it('passes lowercased email to the invite DB query', async () => {
    const eqMock = vi.fn((col: unknown, val: unknown) => ({ col, val }))
    // Override the module-level eq mock for this test.
    const { eq: _origEq } = await import('@/lib/server/db')
    void _origEq
    // We check the eq mock directly — it records the value passed for the
    // email column (invitation.email). The email field stub is 'email' (string).
    mockGetSession.mockResolvedValue({
      user: { id: 'user_inv', email: 'MixedCase@EXAMPLE.COM', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockInvitationFindFirst.mockResolvedValue(null)
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })
    void eqMock

    await resolvePortalAccessForRequest()

    // The invite lookup was triggered (emailVerified=true, isAuthenticated).
    expect(mockInvitationFindFirst).toHaveBeenCalled()
    // The invitation.email value passed via the module-level `eq` mock must
    // be the lowercased form. The mock returns { col, val } tuples.
    // invitation.email stub = 'email'; the value arg should be lowercase.
    const { eq: moduleEq } = await import('@/lib/server/db')
    const eqCalls = (moduleEq as unknown as ReturnType<typeof vi.fn>).mock.calls
    const emailEqCall = eqCalls.find((c: unknown[]) => c[0] === 'email' && typeof c[1] === 'string')
    expect(emailEqCall).toBeDefined()
    if (emailEqCall) {
      expect(emailEqCall[1]).toBe('mixedcase@example.com')
    }
  })
})

// ---------------------------------------------------------------------------
// Fix #6 — accepted invites must not expire (no expires_at filter in resolver)
// ---------------------------------------------------------------------------

describe('resolvePortalAccessForRequest — accepted invites are permanent', () => {
  it('grants invite access even when the invite was sent >14 days ago', async () => {
    // Invite was sent 20 days ago, accepted on day 2. Without the fix, the
    // expires_at filter (< now) would exclude this row and deny access.
    mockGetSession.mockResolvedValue({
      user: { id: 'user_inv', email: 'alice@example.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    // Simulates DB returning the old accepted row (regardless of expires_at).
    mockInvitationFindFirst.mockResolvedValue({ id: 'invite_old' })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result).toEqual({ granted: true, reason: 'invite' })
  })

  it('does NOT use an expires_at filter when looking up accepted invites', async () => {
    // The resolver must pass only 3 conditions to the accepted-invite query:
    // email, kind='portal', status='accepted'. If an expires_at condition is
    // also passed, the old sql`` template tag would be called — verify it is absent.
    const { sql: sqlMock } = await import('@/lib/server/db')
    // Cast through unknown to satisfy TS — sqlMock is vi.fn() in this test file.
    const sqlCalls = (sqlMock as unknown as ReturnType<typeof vi.fn>).mock.calls

    mockGetSession.mockResolvedValue({
      user: { id: 'user_inv', email: 'bob@example.com', emailVerified: true },
    })
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockInvitationFindFirst.mockResolvedValue({ id: 'invite_1' })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [] },
    })

    await resolvePortalAccessForRequest()

    // After the fix, no sql`` template call should contain 'expires_at'
    // (the old code used dbSql`("invitation"."expires_at" IS NULL OR ...)`).
    const expiresAtSqlCall = sqlCalls.find((c: unknown[]) => {
      const parts = c[0] as { raw: string[] }
      return parts?.raw?.some((s: string) => s.includes('expires_at'))
    })
    expect(expiresAtSqlCall).toBeUndefined()
  })
})

describe('resolvePortalAccessForRequest — widget origin marker', () => {
  const SESSION_WITH_ID = {
    user: { id: 'user_wgt', email: 'widget@example.com', emailVerified: true },
    session: { id: 'sess_abc123' },
  }

  it('hasViaWidgetMarker=true when a widget_origin_session row exists for the session', async () => {
    mockGetSession.mockResolvedValue(SESSION_WITH_ID)
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockWidgetOriginSessionFindFirst.mockResolvedValue({ sessionId: 'sess_abc123' })
    mockGetWidgetConfig.mockResolvedValue({ identifyVerification: true })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: true },
    })

    const result = await resolvePortalAccessForRequest()

    // All four conditions met → widget grant.
    expect(result).toEqual({ granted: true, reason: 'widget' })
  })

  it('hasViaWidgetMarker=false (deny) when no widget_origin_session row', async () => {
    mockGetSession.mockResolvedValue(SESSION_WITH_ID)
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockWidgetOriginSessionFindFirst.mockResolvedValue(null)
    mockGetWidgetConfig.mockResolvedValue({ identifyVerification: true })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: true },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })

  it('fails CLOSED on widget_origin_session DB error (treats as no marker)', async () => {
    mockGetSession.mockResolvedValue(SESSION_WITH_ID)
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockWidgetOriginSessionFindFirst.mockRejectedValue(new Error('DB_ERROR'))
    mockGetWidgetConfig.mockResolvedValue({ identifyVerification: true })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: true },
    })

    const result = await resolvePortalAccessForRequest()

    // DB error → fail closed → no marker → widget grant denied.
    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })

  it('identifyVerificationEnabled=true when getWidgetConfig returns identifyVerification=true', async () => {
    mockGetSession.mockResolvedValue(SESSION_WITH_ID)
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockWidgetOriginSessionFindFirst.mockResolvedValue({ sessionId: 'sess_abc123' })
    mockGetWidgetConfig.mockResolvedValue({ identifyVerification: true })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: true },
    })

    const result = await resolvePortalAccessForRequest()
    // identifyVerification=true + marker + widgetSignIn → widget granted.
    expect(result).toEqual({ granted: true, reason: 'widget' })
  })

  it('email-capture widget user (identifyVerification=false) cannot gain widget grant', async () => {
    mockGetSession.mockResolvedValue(SESSION_WITH_ID)
    mockPrincipalFindFirst.mockResolvedValue({ type: 'user', role: 'user' })
    mockWidgetOriginSessionFindFirst.mockResolvedValue({ sessionId: 'sess_abc123' })
    mockGetWidgetConfig.mockResolvedValue({ identifyVerification: false })
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], widgetSignIn: true },
    })

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    if (!result.granted) expect(result.reason).toBe('unauthorized')
  })

  it('skips marker lookup for unauthenticated callers', async () => {
    mockGetSession.mockResolvedValue(null)
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'public', allowedDomains: [] },
    })

    await resolvePortalAccessForRequest()

    expect(mockWidgetOriginSessionFindFirst).not.toHaveBeenCalled()
  })
})

describe('resolvePortalAccessForRequest — segment lookup', () => {
  const SESSION = {
    user: { id: 'user_seg', email: 'seg@example.com', emailVerified: true },
    session: { id: 'sess_seg' },
  }
  const PRINCIPAL_RECORD = { type: 'user', role: 'user', id: 'principal_seg' }

  it('grants via segment when the user is in an allowed segment', async () => {
    mockGetSession.mockResolvedValue(SESSION)
    mockPrincipalFindFirst.mockResolvedValue(PRINCIPAL_RECORD)
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], allowedSegmentIds: ['seg_1'] },
    })
    mockSegmentIdsForPrincipal.mockResolvedValue(new Set(['seg_1', 'seg_2']))

    const result = await resolvePortalAccessForRequest()

    expect(result).toEqual({ granted: true, reason: 'segment' })
  })

  it('denies when the user is in NO allowed segment', async () => {
    mockGetSession.mockResolvedValue(SESSION)
    mockPrincipalFindFirst.mockResolvedValue(PRINCIPAL_RECORD)
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], allowedSegmentIds: ['seg_1'] },
    })
    mockSegmentIdsForPrincipal.mockResolvedValue(new Set(['seg_other']))

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
    expect(result.reason).toBe('unauthorized')
  })

  it('fails CLOSED on segment-lookup error (does not grant)', async () => {
    mockGetSession.mockResolvedValue(SESSION)
    mockPrincipalFindFirst.mockResolvedValue(PRINCIPAL_RECORD)
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], allowedSegmentIds: ['seg_1'] },
    })
    mockSegmentIdsForPrincipal.mockRejectedValue(new Error('DB_ERROR'))

    const result = await resolvePortalAccessForRequest()

    expect(result.granted).toBe(false)
  })

  it('skips the segment lookup when allowedSegmentIds is empty', async () => {
    mockGetSession.mockResolvedValue(SESSION)
    mockPrincipalFindFirst.mockResolvedValue(PRINCIPAL_RECORD)
    mockGetPortalConfig.mockResolvedValue({
      access: { visibility: 'private', allowedDomains: [], allowedSegmentIds: [] },
    })

    await resolvePortalAccessForRequest()

    expect(mockSegmentIdsForPrincipal).not.toHaveBeenCalled()
  })
})
