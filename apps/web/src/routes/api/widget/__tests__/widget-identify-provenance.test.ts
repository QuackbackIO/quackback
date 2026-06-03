/**
 * Widget identify must record provenance per session.
 *
 * Background: the portal-access gate's "widget" branch trusts a
 * `widget_origin_session` marker that's inserted at handoff time.
 * Without per-session provenance, the handoff route can't tell
 * whether the underlying session was HMAC-verified at identify
 * time, and any BA OTT could earn the marker. The provenance row
 * is the fact the handoff route looks up.
 *
 * Upsert semantics: re-identifying the same session demotes (or
 * promotes) hmacVerified to reflect the latest identify path. A
 * session that loses HMAC verification on re-identify must lose
 * the trust it carries.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsert = vi.fn()
const mockValues = vi.fn()
const mockOnConflictDoUpdate = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockInsert(...args),
  },
  widgetIdentifiedSession: {
    sessionId: 'widget_identified_session.session_id',
    hmacVerified: 'widget_identified_session.hmac_verified',
  },
  sql: vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => ({
    kind: 'sql',
    template: strings.join('?'),
  })),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockInsert.mockReturnValue({ values: mockValues })
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate })
  mockOnConflictDoUpdate.mockResolvedValue(undefined)
})

describe('recordWidgetSessionProvenance', () => {
  it('upserts a row with hmacVerified=true for a JWT-verified identify', async () => {
    const { recordWidgetSessionProvenance } = await import('../identify')

    await recordWidgetSessionProvenance('sess_jwt', true)

    expect(mockInsert).toHaveBeenCalledOnce()
    const values = mockValues.mock.calls[0][0]
    expect(values).toMatchObject({ sessionId: 'sess_jwt', hmacVerified: true })
    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce()
  })

  it('upserts a row with hmacVerified=false for an email-capture (unverified) identify', async () => {
    const { recordWidgetSessionProvenance } = await import('../identify')

    await recordWidgetSessionProvenance('sess_capture', false)

    expect(mockInsert).toHaveBeenCalledOnce()
    const values = mockValues.mock.calls[0][0]
    expect(values).toMatchObject({ sessionId: 'sess_capture', hmacVerified: false })
  })

  it('demotes hmacVerified on re-identify via ON CONFLICT', async () => {
    // The upsert's update target must include hmac_verified so a
    // re-identify with the unverified path overwrites a prior
    // verified row. The PK conflict resolves to the new value.
    const { recordWidgetSessionProvenance } = await import('../identify')

    await recordWidgetSessionProvenance('sess_reidentify', false)

    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce()
    const conflictArg = mockOnConflictDoUpdate.mock.calls[0][0] as {
      target: unknown
      set: Record<string, unknown>
    }
    // The PK target is sessionId; set must include hmacVerified.
    expect(conflictArg.target).toBeDefined()
    expect(conflictArg.set).toHaveProperty('hmacVerified')
  })
})
