/**
 * Tests for the portal.access.denied audit emission in _portal beforeLoad.
 *
 * The beforeLoad is not directly invokable from tests since it lives inside
 * a TanStack file-route. We test it by importing the module in a controlled
 * mock environment and verifying the audit logic via the extracted condition
 * that determines when to emit: authenticated + !accessResult.granted.
 *
 * Strategy: the route calls evaluateMyPortalAccessFn() and
 * recordPortalAccessDeniedFn() as module-scope imports. By mocking both via
 * vi.mock before the module loads we can spy on emit behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before any import of _portal.tsx
// ---------------------------------------------------------------------------

const mockEvaluateMyPortalAccessFn = vi.fn()
const mockRecordPortalAccessDeniedFn = vi.fn()
vi.mock('@/lib/server/functions/portal-access', () => ({
  evaluateMyPortalAccessFn: (...a: unknown[]) => mockEvaluateMyPortalAccessFn(...a),
  recordPortalAccessDeniedFn: (...a: unknown[]) => mockRecordPortalAccessDeniedFn(...a),
}))

// Stub enough of the portal route's other dependencies to avoid import errors
vi.mock('@/lib/server/functions/portal', () => ({ fetchUserAvatar: vi.fn() }))
vi.mock('@/lib/server/domains/settings/redact', () => ({
  redactSettingsForClient: vi.fn((x: unknown) => x),
}))
vi.mock('@/lib/shared/theme', () => ({
  generateThemeCSS: vi.fn(() => ''),
  getGoogleFontsUrl: vi.fn(() => null),
}))
vi.mock('@/lib/shared/i18n', () => ({ resolveLocale: vi.fn(async () => 'en') }))
vi.mock('@/lib/shared/types/settings', () => ({ DEFAULT_PORTAL_CONFIG: { oauth: {}, access: {} } }))
vi.mock('@/lib/shared/types/portal-gate-error', () => ({
  parseGateError: vi.fn(() => null),
}))
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
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal RouterContext-shaped context with the given session
 * for use by the _portal beforeLoad.
 */
function makeContext(sessionUser?: {
  id: string
  email: string
  principalType: 'user' | 'anonymous' | 'service'
}) {
  return {
    session: sessionUser
      ? {
          user: {
            id: sessionUser.id,
            email: sessionUser.email,
            principalType: sessionUser.principalType,
            name: 'Test',
            emailVerified: true,
            image: null,
            createdAt: '',
            updatedAt: '',
          },
          session: {
            id: 'session_1',
            expiresAt: '',
            token: 't',
            createdAt: '',
            updatedAt: '',
            userId: sessionUser.id,
          },
        }
      : null,
    settings: null,
    userRole: null as 'admin' | 'member' | 'user' | null,
    baseUrl: 'http://localhost:3000',
    themeCookie: 'system' as const,
    managedFieldPaths: [],
    state: 'active' as const,
    registeredAuthProviders: [],
  }
}

// ---------------------------------------------------------------------------
// Extract and invoke the beforeLoad logic directly.
// Import the route module once at top level (mocks are already set up).
// ---------------------------------------------------------------------------

const { Route: routeOptions } = await import('../_portal')

function getBeforeLoad() {
  // TanStack route stores the options; beforeLoad is accessible via
  // the internal `options` property on the RouteApi object.
  const beforeLoad =
    (routeOptions as unknown as { options?: { beforeLoad?: unknown } }).options?.beforeLoad ??
    (routeOptions as unknown as { beforeLoad?: unknown }).beforeLoad
  if (typeof beforeLoad !== 'function') {
    throw new Error('Could not find beforeLoad on route options')
  }
  return beforeLoad as (args: { context: unknown }) => Promise<void>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRecordPortalAccessDeniedFn.mockResolvedValue(undefined)
})

async function runBeforeLoad(context: ReturnType<typeof makeContext>) {
  return getBeforeLoad()({ context } as never)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_portal beforeLoad — portal.access.denied audit', () => {
  it('calls recordPortalAccessDeniedFn for an authenticated unauthorized visitor', async () => {
    mockEvaluateMyPortalAccessFn.mockResolvedValueOnce({ granted: false, reason: 'unauthorized' })

    const context = makeContext({ id: 'user_1', email: 'x@y.com', principalType: 'user' })
    try {
      await runBeforeLoad(context)
    } catch {
      // expected — gate throws after audit
    }

    // Wait for the fire-and-forget void promise to settle
    await vi.waitFor(() => expect(mockRecordPortalAccessDeniedFn).toHaveBeenCalled())

    expect(mockRecordPortalAccessDeniedFn).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reason: 'unauthorized' } })
    )
  })

  it('does NOT call recordPortalAccessDeniedFn for an anonymous visitor', async () => {
    mockEvaluateMyPortalAccessFn.mockResolvedValueOnce({
      granted: false,
      reason: 'unauthenticated',
    })

    const context = makeContext({ id: 'user_anon', email: '', principalType: 'anonymous' })
    try {
      await runBeforeLoad(context)
    } catch {
      // expected
    }

    // Allow any microtasks to flush
    await new Promise((r) => setTimeout(r, 0))
    expect(mockRecordPortalAccessDeniedFn).not.toHaveBeenCalled()
  })

  it('does NOT call recordPortalAccessDeniedFn when access is granted', async () => {
    mockEvaluateMyPortalAccessFn.mockResolvedValueOnce({ granted: true, reason: 'team' })

    const context = makeContext({ id: 'user_1', email: 'admin@y.com', principalType: 'user' })
    // Should not throw when granted
    await runBeforeLoad(context).catch(() => {})

    // Allow any microtasks to flush
    await new Promise((r) => setTimeout(r, 0))
    expect(mockRecordPortalAccessDeniedFn).not.toHaveBeenCalled()
  })

  it('skips the access-gate (no throw, no audit) for a suspended workspace', async () => {
    // A suspended workspace is surfaced by the root SuspendedView overlay, not
    // the portal access-gate — so beforeLoad must NOT throw the gate error here,
    // and it isn't an access-denial worth auditing.
    mockEvaluateMyPortalAccessFn.mockResolvedValueOnce({ granted: false, reason: 'suspended' })

    const context = makeContext({ id: 'user_1', email: 'admin@y.com', principalType: 'user' })
    await expect(runBeforeLoad(context)).resolves.toBeUndefined()

    await new Promise((r) => setTimeout(r, 0))
    expect(mockRecordPortalAccessDeniedFn).not.toHaveBeenCalled()
  })
})
