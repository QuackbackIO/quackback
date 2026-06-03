/**
 * The widget handoff route must require an HMAC-verified provenance
 * row for the session being handed off. Without this guard, any BA
 * one-time-token from any session source (portal email signup,
 * email-capture widget identify, etc.) can earn the
 * widget_origin_session marker and unlock the portal widget grant.
 *
 * The provenance check reads widget_identified_session; only rows
 * with hmac_verified=true pass. Missing rows fail safe (treat as
 * unverified).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      widgetIdentifiedSession: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
  widgetIdentifiedSession: { sessionId: 'widget_identified_session.session_id' },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isWidgetSessionHmacVerified', () => {
  it('returns true when the session has hmac_verified=true', async () => {
    const { isWidgetSessionHmacVerified } = await import('../auth.widget-handoff')
    mockFindFirst.mockResolvedValueOnce({ hmacVerified: true })

    const result = await isWidgetSessionHmacVerified('sess_verified')

    expect(result).toBe(true)
  })

  it('returns false when the session has hmac_verified=false (email-capture identify)', async () => {
    const { isWidgetSessionHmacVerified } = await import('../auth.widget-handoff')
    mockFindFirst.mockResolvedValueOnce({ hmacVerified: false })

    const result = await isWidgetSessionHmacVerified('sess_unverified')

    expect(result).toBe(false)
  })

  it('returns false when the session has no provenance row (non-widget origin)', async () => {
    // The fail-safe path: a session minted outside /api/widget/identify
    // (e.g. portal email signup that minted a generic BA OTT) has no
    // row in widget_identified_session. Must NOT earn the marker.
    const { isWidgetSessionHmacVerified } = await import('../auth.widget-handoff')
    mockFindFirst.mockResolvedValueOnce(undefined)

    const result = await isWidgetSessionHmacVerified('sess_no_row')

    expect(result).toBe(false)
  })

  it('returns false when the DB lookup throws (defensive)', async () => {
    // A query error must not be interpreted as success — defaulting
    // to false keeps the gate closed even under DB hiccups.
    const { isWidgetSessionHmacVerified } = await import('../auth.widget-handoff')
    mockFindFirst.mockRejectedValueOnce(new Error('connection refused'))

    const result = await isWidgetSessionHmacVerified('sess_db_error')

    expect(result).toBe(false)
  })
})
