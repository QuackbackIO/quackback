/**
 * Unit tests for the widget OTT handoff route.
 *
 * Runs the route's real `consumeWidgetHandoffFn` handler: `createServerFn` is
 * mocked to hand back the handler itself, and the database, audit log, session
 * lookup and the verify `fetch` are mocked around it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-start', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-start')>()),
  createServerFn: () => {
    const chain = {
      validator: () => chain,
      handler: (fn: unknown) => fn,
    }
    return chain
  },
}))

const mockSetResponseHeader = vi.fn()
const mockGetRequestHeaders = vi.fn(() => new Headers())

vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: (...args: unknown[]) => mockSetResponseHeader(...args),
  getRequestHeaders: () => mockGetRequestHeaders(),
}))

// Config mock
vi.mock('@/lib/server/config', () => ({
  config: { baseUrl: 'http://localhost:3000' },
}))

// Audit log mock
const mockRecordAuditEvent = vi.fn()
vi.mock('@/lib/server/audit/log', () => ({
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  recordAuditEvent: (arg: any) => mockRecordAuditEvent(arg),
}))

// The incoming request's own session (the dashboard-cookie guard).
const mockGetSession = vi.fn(
  async (): Promise<{
    user: { id: string }
    session: { scope: string }
  } | null> => null
)
vi.mock('@/lib/server/auth/session', () => ({
  getSession: () => mockGetSession(),
}))

// DB mock
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnConflictDoNothing: any = vi.fn()
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const mockInsertValues: any = vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing }))
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const mockDbInsert: any = vi.fn(() => ({ values: mockInsertValues }))
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const mockUpdateWhere: any = vi.fn(async () => undefined)
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const mockUpdateSet: any = vi.fn(() => ({ where: mockUpdateWhere }))
// oxlint-disable-next-line @typescript-eslint/no-explicit-any
const mockDbUpdate: any = vi.fn(() => ({ set: mockUpdateSet }))
// Provenance lookup: tests default to hmacVerified=true so the
// existing redirect/audit assertions still exercise the success
// path. The provenance gate itself is covered in detail by
// auth.widget-handoff-provenance.test.ts.
const mockWidgetIdentifiedFindFirst = vi.fn(async () => ({ hmacVerified: true }))
const mockPrincipalFindFirst = vi.fn(async (): Promise<{ role: string } | null> => ({
  role: 'user',
}))
vi.mock('@/lib/server/db', () => ({
  db: {
    // oxlint-disable-next-line @typescript-eslint/no-explicit-any
    insert: (arg: any) => mockDbInsert(arg),
    update: (arg: unknown) => mockDbUpdate(arg),
    query: {
      widgetIdentifiedSession: {
        findFirst: (...args: unknown[]) => mockWidgetIdentifiedFindFirst(...(args as [])),
      },
      principal: {
        findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...(args as [])),
      },
    },
  },
  widgetOriginSession: {},
  widgetIdentifiedSession: { sessionId: 'widget_identified_session.session_id' },
  principal: { userId: 'principal.user_id' },
  session: { id: 'session.id' },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
}))

// Fetch mock
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

type HandoffResult =
  | { kind: 'redirect'; to: string; search?: Record<string, string> }
  | { kind: 'error'; status: 'invalid' | 'expired' | 'error' }

/** Call the route's real server fn handler with the parsed search params. */
async function runHandoff(search: string): Promise<HandoffResult> {
  const { consumeWidgetHandoffFn } = await import('../auth.widget-handoff')
  const handler = consumeWidgetHandoffFn as unknown as (input: {
    data: { ott?: string; returnTo?: string }
  }) => Promise<HandoffResult>
  const params = new URLSearchParams(search)
  return handler({
    data: {
      ott: params.get('ott') ?? undefined,
      returnTo: params.get('returnTo') ?? undefined,
    },
  })
}

function okResponse(session: { id: string; userId: string }): Response {
  const headers = new Headers()
  headers.append('set-cookie', 'better-auth.session_token=abc; Path=/; HttpOnly')
  return new Response(
    JSON.stringify({
      session: { id: session.id, userId: session.userId },
      user: { id: session.userId },
    }),
    { status: 200, headers }
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mockGetRequestHeaders.mockReturnValue(new Headers())
})

describe('isHandoffPrincipalTeammate', () => {
  it('is true for admin and member, false for portal users', async () => {
    const { isHandoffPrincipalTeammate } = await import('../auth.widget-handoff')
    mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'admin' })
    expect(await isHandoffPrincipalTeammate('user_admin')).toBe(true)
    mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'member' })
    expect(await isHandoffPrincipalTeammate('user_member')).toBe(true)
    mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'user' })
    expect(await isHandoffPrincipalTeammate('user_customer')).toBe(false)
  })

  it('is false when no principal exists', async () => {
    const { isHandoffPrincipalTeammate } = await import('../auth.widget-handoff')
    mockPrincipalFindFirst.mockResolvedValueOnce(null)
    expect(await isHandoffPrincipalTeammate('user_unknown')).toBe(false)
  })
})

describe('verify request', () => {
  it('verifyHandoffToken sends no cookie even when the browser has cookies', async () => {
    // The incoming request carries portal-host cookies (a theme preference
    // plus CDN cookies). BA rejects a cookie-bearing request without Origin
    // with 403 MISSING_OR_NULL_ORIGIN, so none may be forwarded.
    mockGetRequestHeaders.mockReturnValue(new Headers({ cookie: 'cf_clearance=x; theme=dark' }))
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }))

    const { verifyHandoffToken } = await import('../auth.widget-handoff')
    await verifyHandoffToken('http://localhost:3000', 'tok_1')

    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:3000/api/auth/one-time-token/verify')
    const headers = new Headers(init.headers)
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ token: 'tok_1' })
  })

  it('the handoff sends no cookie to the verify endpoint when the browser has cookies', async () => {
    mockGetRequestHeaders.mockReturnValue(new Headers({ cookie: 'cf_clearance=x; theme=dark' }))
    mockFetch.mockResolvedValue(okResponse({ id: 'sess_1', userId: 'user_abc' }))

    const result = await runHandoff('?ott=tok_2')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('http://localhost:3000/api/auth/one-time-token/verify')
    expect(new Headers(init.headers).get('cookie')).toBeNull()
    expect(JSON.parse(init.body)).toEqual({ token: 'tok_2' })
    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })
})

describe('widget handoff — missing OTT', () => {
  it('returns invalid status when ott param is absent', async () => {
    const result = await runHandoff('')
    expect(result).toEqual({ kind: 'error', status: 'invalid' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('records the invalid audit event when ott is missing', async () => {
    await runHandoff('')
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        metadata: expect.objectContaining({ reason: 'missing_ott' }),
      })
    )
  })
})

describe('widget handoff — valid OTT', () => {
  it('redirects to / on a valid OTT', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'sess_1', userId: 'user_abc' }))

    const result = await runHandoff('?ott=valid-token')
    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })

  it('forwards Set-Cookie header from BA response', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'sess_1', userId: 'user_abc' }))

    await runHandoff('?ott=valid-token')
    expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', [
      expect.stringContaining('better-auth.session_token=abc'),
    ])
  })

  it('inserts the widget_origin_session marker', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'sess_1', userId: 'user_abc' }))

    await runHandoff('?ott=valid-token')
    expect(mockInsertValues).toHaveBeenCalledWith({ sessionId: 'sess_1', userId: 'user_abc' })
  })

  it('promotes the verified session to portal scope', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'sess_1', userId: 'user_abc' }))

    await runHandoff('?ott=valid-token')
    expect(mockUpdateSet).toHaveBeenCalledWith({ scope: 'portal' })
  })

  it('records the consumed audit event', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'sess_1', userId: 'user_abc' }))

    await runHandoff('?ott=valid-token')
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'portal.widget_handshake.consumed',
        outcome: 'success',
      })
    )
  })

  it('respects a safe returnTo param', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'sess_1', userId: 'user_abc' }))

    const result = await runHandoff('?ott=valid-token&returnTo=/posts/123')
    expect(result).toEqual({ kind: 'redirect', to: '/posts/123' })
  })

  it('rejects an unsafe returnTo (absolute URL) and falls back to /', async () => {
    mockFetch.mockResolvedValue(okResponse({ id: 'sess_1', userId: 'user_abc' }))

    const result = await runHandoff(
      `?ott=valid-token&returnTo=${encodeURIComponent('https://evil.com')}`
    )
    expect(result).toEqual({ kind: 'redirect', to: '/' })
  })

  describe('provenance gate', () => {
    it('rejects when the session has no widget_identified_session row', async () => {
      // No row → undefined → isWidgetSessionHmacVerified returns false →
      // handoff refuses to insert the marker and returns invalid.
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_no_row', userId: 'user_xyz' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce(
        undefined as unknown as { hmacVerified: boolean }
      )

      const result = await runHandoff('?ott=valid-token')
      expect(result).toEqual({ kind: 'error', status: 'invalid' })
      expect(mockDbInsert).not.toHaveBeenCalled()
      expect(mockUpdateSet).not.toHaveBeenCalled()
    })

    it('rejects when hmac_verified is false (email-capture identify)', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_capture', userId: 'user_xyz' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce({ hmacVerified: false })

      const result = await runHandoff('?ott=valid-token')
      expect(result).toEqual({ kind: 'error', status: 'invalid' })
      expect(mockDbInsert).not.toHaveBeenCalled()
    })

    it('records an audit failure with unverified_provenance reason on reject', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_capture', userId: 'user_xyz' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce({ hmacVerified: false })

      await runHandoff('?ott=valid-token')

      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'portal.widget_handshake.invalid',
          outcome: 'failure',
          metadata: expect.objectContaining({ reason: 'unverified_provenance' }),
        })
      )
    })

    it('does NOT forward Set-Cookie when provenance fails (G7)', async () => {
      // A valid BA OTT minted by a non-widget flow must not install its
      // session in the browser when the handoff is refused, so the cookie
      // is forwarded only AFTER provenance is confirmed.
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_capture', userId: 'user_xyz' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce({ hmacVerified: false })

      await runHandoff('?ott=valid-token')

      expect(mockSetResponseHeader).not.toHaveBeenCalled()
    })

    it('does forward Set-Cookie when provenance passes (success-path parity)', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_ok', userId: 'user_ok' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce({ hmacVerified: true })

      await runHandoff('?ott=valid-token')

      expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', [
        expect.stringContaining('better-auth.session_token'),
      ])
    })
  })

  describe('teammate identity', () => {
    it('does not install a portal cookie when the identified user is an admin', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_admin', userId: 'user_admin' }))
      mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'admin' })

      const result = await runHandoff('?ott=valid-token')

      expect(result.kind).toBe('redirect')
      expect(mockSetResponseHeader).not.toHaveBeenCalled()
      expect(mockDbInsert).not.toHaveBeenCalled()
      expect(mockUpdateSet).not.toHaveBeenCalled()
    })

    it('does not install a portal cookie when the identified user is a member', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_member', userId: 'user_member' }))
      mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'member' })

      await runHandoff('?ott=valid-token')

      expect(mockSetResponseHeader).not.toHaveBeenCalled()
    })

    it('sends teammates to the portal sign-in landing without authenticating', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_admin', userId: 'user_admin' }))
      mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'admin' })

      const result = await runHandoff('?ott=valid-token&returnTo=/posts/abc')

      expect(result).toEqual({
        kind: 'redirect',
        to: '/',
        search: { auth: 'signin', callbackUrl: '/posts/abc' },
      })
    })

    it('records teammate_identity when skipping the cookie', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_admin', userId: 'user_admin' }))
      mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'admin' })

      await runHandoff('?ott=valid-token')

      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'portal.widget_handshake.invalid',
          outcome: 'failure',
          metadata: expect.objectContaining({ reason: 'teammate_identity' }),
        })
      )
    })

    it('sends an already-authenticated teammate to returnTo without replacing the cookie', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_admin', userId: 'user_admin' }))
      mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'admin' })
      mockGetSession.mockResolvedValueOnce({
        user: { id: 'user_admin' },
        session: { scope: 'dashboard' },
      })

      const result = await runHandoff('?ott=valid-token&returnTo=/posts/abc')

      expect(result).toEqual({ kind: 'redirect', to: '/posts/abc' })
      expect(mockSetResponseHeader).not.toHaveBeenCalled()
    })

    it('does not replace a dashboard cookie with a customer OTT', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_customer', userId: 'user_customer' }))
      mockPrincipalFindFirst.mockResolvedValueOnce({ role: 'user' })
      mockGetSession.mockResolvedValueOnce({
        user: { id: 'user_admin' },
        session: { scope: 'dashboard' },
      })

      const result = await runHandoff('?ott=valid-token&returnTo=/posts/abc')

      expect(result).toEqual({ kind: 'redirect', to: '/posts/abc' })
      expect(mockSetResponseHeader).not.toHaveBeenCalled()
      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: 'dashboard_session_present' }),
        })
      )
    })

    it('installs the cookie over an existing portal session', async () => {
      mockFetch.mockResolvedValue(okResponse({ id: 'sess_customer', userId: 'user_customer' }))
      mockGetSession.mockResolvedValueOnce({
        user: { id: 'user_other' },
        session: { scope: 'portal' },
      })

      const result = await runHandoff('?ott=valid-token&returnTo=/posts/abc')

      expect(result).toEqual({ kind: 'redirect', to: '/posts/abc' })
      expect(mockSetResponseHeader).toHaveBeenCalledWith('Set-Cookie', [
        expect.stringContaining('better-auth.session_token'),
      ])
    })
  })
})

describe('widget handoff — invalid/expired/replayed OTT', () => {
  it('returns invalid status when BA responds with 400', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 400 }))

    const result = await runHandoff('?ott=bad-token')
    expect(result).toEqual({ kind: 'error', status: 'invalid' })
  })

  it('returns error status when BA responds with a non-400 error', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 403 }))

    const result = await runHandoff('?ott=bad-token')
    expect(result).toEqual({ kind: 'error', status: 'error' })
  })

  it('records the BA status in the invalid audit event', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 400 }))

    await runHandoff('?ott=bad-token')
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        metadata: { reason: 'ba_status_400' },
      })
    )
  })

  it('returns error status when the fetch itself throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await runHandoff('?ott=token-that-causes-error')
    expect(result).toEqual({ kind: 'error', status: 'error' })
  })

  it('does not insert marker or set a cookie on invalid OTT', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 400 }))

    await runHandoff('?ott=bad-token')
    expect(mockDbInsert).not.toHaveBeenCalled()
    expect(mockSetResponseHeader).not.toHaveBeenCalled()
  })
})
