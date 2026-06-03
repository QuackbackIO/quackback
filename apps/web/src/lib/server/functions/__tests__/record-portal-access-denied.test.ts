/**
 * Unit tests for recordPortalAccessDeniedFn.
 *
 * Handler registration order in portal-access.ts:
 *   0  evaluateMyPortalAccessFn      — .handler(...)
 *   1  recordPortalAccessDeniedFn    — .inputValidator(...).handler(...)
 *   2  updatePortalAccessFn          — .inputValidator(...).handler(...)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// createServerFn mock — captures all .handler() callbacks in order
// ---------------------------------------------------------------------------

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

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
  // resolvePortalAccessForRequest is wrapped in createServerOnlyFn — the
  // mock just returns the inner function so the module loads.
  createServerOnlyFn: <T>(fn: T) => fn,
}))

// ---------------------------------------------------------------------------
// Static server-side imports mocked at module scope
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// ---------------------------------------------------------------------------
// Dynamic import targets
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn()

vi.mock('@/lib/server/auth/index', () => ({
  auth: { api: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}))

const mockRecordAuditEvent = vi.fn()

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
  actorFromAuth: vi.fn(),
}))

// Stub remaining dependencies that are imported at module top-level
vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn(),
  updatePortalConfig: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.widget', () => ({
  getWidgetConfig: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/portal-access', () => ({
  evaluatePortalAccess: vi.fn(),
}))
vi.mock('@quackback/ids', () => ({}))

// ---------------------------------------------------------------------------
// Handler index
// ---------------------------------------------------------------------------

const RECORD_PORTAL_ACCESS_DENIED = 1

let handler: AnyHandler

beforeEach(async () => {
  vi.clearAllMocks()
  mockRecordAuditEvent.mockResolvedValue(undefined)
  if (handlers.length === 0) {
    await import('../portal-access')
  }
  handler = handlers[RECORD_PORTAL_ACCESS_DENIED]
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recordPortalAccessDeniedFn handler', () => {
  it('emits portal.access.denied when there is an authenticated session', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user_1', email: 'x@example.com' },
      session: { id: 'session_1' },
    })

    await handler({ data: { reason: 'unauthorized' } })

    expect(mockRecordAuditEvent).toHaveBeenCalledOnce()
    expect(mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'portal.access.denied',
        outcome: 'failure',
        actor: expect.objectContaining({ userId: 'user_1', email: 'x@example.com', type: 'user' }),
        target: { type: 'settings', id: 'portal_config' },
        metadata: { reason: 'unauthorized' },
      })
    )
  })

  it('does NOT emit portal.access.denied when there is no session', async () => {
    mockGetSession.mockResolvedValue(null)

    await handler({ data: { reason: 'unauthenticated' } })

    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit portal.access.denied when getSession throws', async () => {
    mockGetSession.mockRejectedValue(new Error('DB offline'))

    await handler({ data: { reason: 'unauthorized' } })

    expect(mockRecordAuditEvent).not.toHaveBeenCalled()
  })
})
