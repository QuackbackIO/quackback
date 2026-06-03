/**
 * Unit tests for the widget OTT handoff route loader logic.
 *
 * The loader is tested by exercising its extracted behavior via mocks —
 * the actual TanStack Start route is not instantiated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recordAuditEvent: (arg: any) => mockRecordAuditEvent(arg),
}))

// DB mock
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockOnConflictDoNothing: any = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockInsertValues: any = vi.fn(() => ({ onConflictDoNothing: mockOnConflictDoNothing }))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDbInsert: any = vi.fn(() => ({ values: mockInsertValues }))
// Provenance lookup: tests default to hmacVerified=true so the
// existing redirect/audit assertions still exercise the success
// path. The provenance gate itself is covered in detail by
// auth.widget-handoff-provenance.test.ts.
const mockWidgetIdentifiedFindFirst = vi.fn(async () => ({ hmacVerified: true }))
vi.mock('@/lib/server/db', () => ({
  db: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert: (arg: any) => mockDbInsert(arg),
    query: {
      widgetIdentifiedSession: {
        findFirst: (...args: unknown[]) => mockWidgetIdentifiedFindFirst(...(args as [])),
      },
    },
  },
  widgetOriginSession: {},
  widgetIdentifiedSession: { sessionId: 'widget_identified_session.session_id' },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
}))

// Fetch mock
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// Re-implement the loader logic directly to test it in isolation.
// (We can't import a TanStack Start route's loader directly in Vitest without
// a full router setup, so we extract and test the branching logic.)
// ---------------------------------------------------------------------------

async function runHandoffLoader(search: string) {
  const { setResponseHeader, getRequestHeaders } = await import('@tanstack/react-start/server')
  const { config } = await import('@/lib/server/config')
  const { db, widgetOriginSession } = await import('@/lib/server/db')
  const { recordAuditEvent } = await import('@/lib/server/audit/log')
  const { isSafeCallbackUrl } = await import('@/lib/shared/routing')

  const params = new URLSearchParams(search)
  const ott = params.get('ott')
  const returnToRaw = params.get('returnTo')
  const returnTo = isSafeCallbackUrl(returnToRaw) ? returnToRaw : '/'

  if (!ott) {
    await recordAuditEvent({
      event: 'portal.widget_handshake.invalid',
      outcome: 'failure',
      actor: {},
      metadata: { reason: 'missing_ott' },
    })
    return { status: 'invalid' as const }
  }

  let verifyResponse: Response
  try {
    verifyResponse = await fetch(`${config.baseUrl}/api/auth/one-time-token/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(getRequestHeaders().get('cookie')
          ? { cookie: getRequestHeaders().get('cookie')! }
          : {}),
      },
      body: JSON.stringify({ token: ott }),
    })
  } catch {
    await recordAuditEvent({
      event: 'portal.widget_handshake.invalid',
      outcome: 'failure',
      actor: {},
      metadata: { reason: 'fetch_error' },
    })
    return { status: 'error' as const }
  }

  if (!verifyResponse.ok) {
    await recordAuditEvent({
      event: 'portal.widget_handshake.invalid',
      outcome: 'failure',
      actor: {},
      metadata: { reason: `ba_status_${verifyResponse.status}` },
    })
    const status = verifyResponse.status === 400 ? ('invalid' as const) : ('error' as const)
    return { status }
  }

  // Collect the Set-Cookie payload but DO NOT forward it yet — the
  // provenance check below must succeed first. A generic BA OTT (from
  // any non-widget flow) can pass the verify step; if we forwarded the
  // cookie eagerly, that OTT would install the session in the browser
  // even when the handoff is rejected.
  const setCookieValues = verifyResponse.headers.getSetCookie?.() ?? []
  if (setCookieValues.length === 0) {
    const single = verifyResponse.headers.get('set-cookie')
    if (single) setCookieValues.push(single)
  }

  let sessionId: string | null = null
  let userId: string | null = null
  try {
    const body = (await verifyResponse.json()) as {
      session?: { id?: string; userId?: string }
      user?: { id?: string }
    }
    sessionId = body?.session?.id ?? null
    userId = body?.user?.id ?? body?.session?.userId ?? null
  } catch {
    /* ignore */
  }

  if (!sessionId || !userId) {
    await recordAuditEvent({
      event: 'portal.widget_handshake.invalid',
      outcome: 'failure',
      actor: {},
      metadata: { reason: 'missing_session_info' },
    })
    return { status: 'invalid' as const }
  }

  // Provenance gate — only HMAC-verified widget sessions earn the marker.
  // Mirrors isWidgetSessionHmacVerified in the production route.
  const { isWidgetSessionHmacVerified } = await import('../auth.widget-handoff')
  const provenanceOk = await isWidgetSessionHmacVerified(sessionId)
  if (!provenanceOk) {
    await recordAuditEvent({
      event: 'portal.widget_handshake.invalid',
      outcome: 'failure',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actor: { userId: userId as any },
      target: { type: 'session', id: sessionId },
      metadata: { reason: 'unverified_provenance' },
    })
    return { status: 'invalid' as const }
  }

  // Provenance passed — safe to install the session cookie now.
  for (const cookie of setCookieValues) {
    setResponseHeader('Set-Cookie', cookie)
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.insert(widgetOriginSession) as any)
      .values({ sessionId, userId })
      .onConflictDoNothing()
  } catch {
    /* non-fatal */
  }

  await recordAuditEvent({
    event: 'portal.widget_handshake.consumed',
    outcome: 'success',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actor: { userId: userId as any },
    target: { type: 'session', id: sessionId },
  })

  // In the real route, this throws redirect(). Return a sentinel for testing.
  return { status: 'redirect' as const, to: returnTo }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe('widget handoff loader — missing OTT', () => {
  it('returns invalid status when ott param is absent', async () => {
    const result = await runHandoffLoader('')
    expect(result.status).toBe('invalid')
  })

  it('records the invalid audit event when ott is missing', async () => {
    await runHandoffLoader('')
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
        metadata: expect.objectContaining({ reason: 'missing_ott' }),
      })
    )
  })
})

describe('widget handoff loader — valid OTT', () => {
  function makeOkResponse(session: { id: string; userId: string }) {
    const headers = new Headers()
    headers.append('set-cookie', 'better-auth.session_token=abc; Path=/; HttpOnly')
    return {
      ok: true,
      status: 200,
      headers,
      json: () =>
        Promise.resolve({
          session: { id: session.id, userId: session.userId },
          user: { id: session.userId },
        }),
    } as unknown as Response
  }

  it('redirects to / on a valid OTT', async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_1', userId: 'user_abc' }))

    const result = await runHandoffLoader('?ott=valid-token')
    expect(result.status).toBe('redirect')
    if (result.status === 'redirect') expect(result.to).toBe('/')
  })

  it('forwards Set-Cookie header from BA response', async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_1', userId: 'user_abc' }))

    await runHandoffLoader('?ott=valid-token')
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('better-auth.session_token')
    )
  })

  it('inserts the widget_origin_session marker', async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_1', userId: 'user_abc' }))

    await runHandoffLoader('?ott=valid-token')
    expect(mockDbInsert).toHaveBeenCalled()
  })

  it('records the consumed audit event', async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_1', userId: 'user_abc' }))

    await runHandoffLoader('?ott=valid-token')
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'portal.widget_handshake.consumed',
        outcome: 'success',
      })
    )
  })

  it('respects a safe returnTo param', async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_1', userId: 'user_abc' }))

    const result = await runHandoffLoader('?ott=valid-token&returnTo=/posts/123')
    if (result.status === 'redirect') expect(result.to).toBe('/posts/123')
  })

  it('rejects an unsafe returnTo (absolute URL) and falls back to /', async () => {
    mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_1', userId: 'user_abc' }))

    const result = await runHandoffLoader(
      `?ott=valid-token&returnTo=${encodeURIComponent('https://evil.com')}`
    )
    if (result.status === 'redirect') expect(result.to).toBe('/')
  })

  describe('provenance gate', () => {
    it('rejects when the session has no widget_identified_session row', async () => {
      // No row → undefined → isWidgetSessionHmacVerified returns false →
      // handoff refuses to insert the marker and returns invalid.
      mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_no_row', userId: 'user_xyz' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce(
        undefined as unknown as { hmacVerified: boolean }
      )

      const result = await runHandoffLoader('?ott=valid-token')
      expect(result.status).toBe('invalid')
      expect(mockDbInsert).not.toHaveBeenCalled()
    })

    it('rejects when hmac_verified is false (email-capture identify)', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_capture', userId: 'user_xyz' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce({ hmacVerified: false })

      const result = await runHandoffLoader('?ott=valid-token')
      expect(result.status).toBe('invalid')
      expect(mockDbInsert).not.toHaveBeenCalled()
    })

    it('records an audit failure with unverified_provenance reason on reject', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_capture', userId: 'user_xyz' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce({ hmacVerified: false })

      await runHandoffLoader('?ott=valid-token')

      expect(mockRecordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'portal.widget_handshake.invalid',
          outcome: 'failure',
          metadata: expect.objectContaining({ reason: 'unverified_provenance' }),
        })
      )
    })

    it('does NOT forward Set-Cookie when provenance fails (G7)', async () => {
      // Regression: the route used to call setResponseHeader('Set-Cookie',
      // …) immediately after the OTT verify succeeded, BEFORE running the
      // provenance check. Any valid BA OTT (even one minted by a
      // non-widget flow) would then install the session cookie in the
      // browser even though the handoff was refused. The cookie must be
      // forwarded only AFTER provenance is confirmed.
      mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_capture', userId: 'user_xyz' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce({ hmacVerified: false })

      await runHandoffLoader('?ott=valid-token')

      expect(mockSetResponseHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.anything())
    })

    it('does forward Set-Cookie when provenance passes (success-path parity)', async () => {
      mockFetch.mockResolvedValue(makeOkResponse({ id: 'sess_ok', userId: 'user_ok' }))
      mockWidgetIdentifiedFindFirst.mockResolvedValueOnce({ hmacVerified: true })

      await runHandoffLoader('?ott=valid-token')

      expect(mockSetResponseHeader).toHaveBeenCalledWith(
        'Set-Cookie',
        expect.stringContaining('better-auth.session_token')
      )
    })
  })
})

describe('widget handoff loader — invalid/expired/replayed OTT', () => {
  it('returns invalid status when BA responds with 400', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
    } as Response)

    const result = await runHandoffLoader('?ott=bad-token')
    expect(result.status).toBe('invalid')
  })

  it('returns error status when BA responds with a non-400 error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
    } as Response)

    const result = await runHandoffLoader('?ott=bad-token')
    expect(result.status).toBe('error')
  })

  it('records the invalid audit event on 400 from BA', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
    } as Response)

    await runHandoffLoader('?ott=bad-token')
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'portal.widget_handshake.invalid',
        outcome: 'failure',
      })
    )
  })

  it('returns error status when the fetch itself throws', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await runHandoffLoader('?ott=token-that-causes-error')
    expect(result.status).toBe('error')
  })

  it('does not insert marker on invalid OTT', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
    } as Response)

    await runHandoffLoader('?ott=bad-token')
    expect(mockDbInsert).not.toHaveBeenCalled()
  })
})
