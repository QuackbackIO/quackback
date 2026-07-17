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
}))
vi.mock('@/lib/shared/i18n', () => ({
  resolveLocale: vi.fn(async () => 'en'),
  SUPPORTED_LOCALES: ['en', 'de', 'fr', 'es', 'ar', 'ru', 'pt-br', 'zh-cn', 'zh-tw'],
}))
vi.mock('@/lib/shared/types/settings', () => ({
  DEFAULT_PORTAL_CONFIG: { oauth: {}, access: {} },
  DEFAULT_AUTH_CONFIG: { oauth: { google: true, github: true, password: true }, openSignup: false },
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
  setResponseHeader: vi.fn(),
}))
vi.mock('@/lib/server/functions/instant-sso', () => ({
  resolveInstantSsoRedirectFn: vi.fn(),
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
// Extract and invoke the loader logic directly. The portal-visibility gate
// lives in the loader (not beforeLoad) so a post-sign-in router.invalidate()
// re-evaluates it. Import the route module once (mocks are already set up).
// ---------------------------------------------------------------------------

const { Route: routeOptions } = await import('../_portal')

function getLoader() {
  const loader =
    (routeOptions as unknown as { options?: { loader?: unknown } }).options?.loader ??
    (routeOptions as unknown as { loader?: unknown }).loader
  if (typeof loader !== 'function') {
    throw new Error('Could not find loader on route options')
  }
  return loader as (args: { context: unknown }) => Promise<unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRecordPortalAccessDeniedFn.mockResolvedValue(undefined)
})

async function runLoader(context: ReturnType<typeof makeContext>) {
  return getLoader()({ context } as never)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_portal loader — portal-visibility gate + access.denied audit', () => {
  it('calls recordPortalAccessDeniedFn for an authenticated unauthorized visitor', async () => {
    mockEvaluateMyPortalAccessFn.mockResolvedValueOnce({ granted: false, reason: 'unauthorized' })

    const context = makeContext({ id: 'user_1', email: 'x@y.com', principalType: 'user' })
    // The loader returns the gate decision (no throw); the audit still emits.
    await runLoader(context)

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
    await runLoader(context)

    // Allow any microtasks to flush
    await new Promise((r) => setTimeout(r, 0))
    expect(mockRecordPortalAccessDeniedFn).not.toHaveBeenCalled()
  })

  it('does NOT call recordPortalAccessDeniedFn when access is granted', async () => {
    mockEvaluateMyPortalAccessFn.mockResolvedValueOnce({ granted: true, reason: 'team' })

    const context = makeContext({ id: 'user_1', email: 'admin@y.com', principalType: 'user' })
    // Should not throw when granted
    await runLoader(context).catch(() => {})

    // Allow any microtasks to flush
    await new Promise((r) => setTimeout(r, 0))
    expect(mockRecordPortalAccessDeniedFn).not.toHaveBeenCalled()
  })

  // The loader denies access WITHOUT throwing: it returns the gate decision so
  // the _portal component renders the sign-in wall as a normal 200 page (the
  // right status for a login screen — not the 404/500 a throw would produce, and
  // no error/notFound console noise). Evaluating in the loader (not beforeLoad)
  // means a post-sign-in router.invalidate() re-runs it so the gate clears once
  // authorized. Data stays protected because every portal read fn independently
  // gates on the access resolver, so the child loaders that run return empty.
  it('returns the gate decision without throwing, carrying the payload', async () => {
    mockEvaluateMyPortalAccessFn.mockResolvedValueOnce({
      granted: false,
      reason: 'unauthenticated',
    })

    const context = makeContext({ id: 'user_anon', email: '', principalType: 'anonymous' })
    // Must NOT throw — the component renders the gate at HTTP 200.
    const result = (await runLoader(context)) as {
      gate?: { type?: string; locale?: string }
    }

    expect(result?.gate?.type).toBe('portal-access-gate')
    // Locale carried so the gate's auth dialog renders under PortalIntlProvider.
    expect(result?.gate?.locale).toBe('en')
  })
})
