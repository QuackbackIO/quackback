import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * On a section host the admin does not run, and every session there is portal
 * scope, so the role the bootstrap sends reads as a portal user's. The portal
 * header still links a teammate to the admin on the primary domain: the
 * bootstrap sends that address, only to a signed-in, unblocked teammate on a
 * section host, and changes nothing else about the session.
 */

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  getRequestSession: vi.fn(),
  getRequestPrincipal: vi.fn(),
  handlers: [] as Array<() => Promise<unknown>>,
  host: 'feedback.acme.com',
  cookie: 'better-auth.session_token=tok' as string | null,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => ({
    handler(fn: () => Promise<unknown>) {
      hoisted.handlers.push(fn)
      return fn
    },
  }),
}))
vi.mock('@tanstack/react-start/server', () => {
  const headers = () =>
    new Headers({ host: hoisted.host, ...(hoisted.cookie ? { cookie: hoisted.cookie } : {}) })
  return {
    getRequestHeaders: headers,
    getRequestUrl: () => new URL(`https://${hoisted.host}/`),
    getRequest: () => new Request(`https://${hoisted.host}/`, { headers: headers() }),
    setResponseHeader: vi.fn(),
  }
})
vi.mock('@/lib/server/auth/request-session', () => ({
  getRequestSession: hoisted.getRequestSession,
  getRequestPrincipal: hoisted.getRequestPrincipal,
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredAuthProviders: async () => ['password'],
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.com' } }))
vi.mock('@/lib/server/domains/help-center/help-center-domain.service', () => ({
  resolveHelpCenterBaseUrl: ({ fallback }: { fallback: string }) => fallback,
}))
vi.mock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => false }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

const portalConfig = {
  sectionDomains: {
    feedback: { hostname: 'feedback.acme.com', verifiedAt: '2026-11-01T00:00:00.000Z' },
  },
}

const settings = {
  settings: { id: 'workspace_1', name: 'Acme', slug: 'acme', setupState: null },
  name: 'Acme',
  slug: 'acme',
  portalConfig,
  featureFlags: { feedback: true },
  managedFieldPaths: [],
}

function signedIn(scope: string) {
  const at = new Date('2026-11-01T00:00:00.000Z')
  return {
    session: { id: 'sess_1', scope, expiresAt: at, createdAt: at, updatedAt: at },
    user: {
      id: 'user_1',
      name: 'Ada',
      email: 'ada@acme.com',
      emailVerified: true,
      image: null,
      createdAt: at,
      updatedAt: at,
    },
  }
}

function principal(overrides: Record<string, unknown> = {}) {
  return { id: 'principal_1', role: 'admin', type: 'user', blockedAt: null, ...overrides }
}

interface Bootstrap {
  userRole: string | null
  session: { session: { scope: string } } | null
  primaryAdminUrl?: string
}

async function getBootstrapData(): Promise<Bootstrap> {
  if (hoisted.handlers.length === 0) await import('../bootstrap')
  return (await hoisted.handlers[0]!()) as Bootstrap
}

beforeEach(() => {
  hoisted.getWorkspaceSettings.mockReset().mockResolvedValue(settings)
  hoisted.getRequestSession.mockReset().mockResolvedValue(signedIn('portal'))
  hoisted.getRequestPrincipal.mockReset().mockResolvedValue(principal())
  hoisted.host = 'feedback.acme.com'
  hoisted.cookie = 'better-auth.session_token=tok'
})

describe('the admin link for a teammate on a section host', () => {
  it("sends a teammate the admin's address on the primary domain", async () => {
    const data = await getBootstrapData()
    expect(data.primaryAdminUrl).toBe('https://acme.com/admin')
  })

  it('sends it to a member as to an admin', async () => {
    hoisted.getRequestPrincipal.mockResolvedValue(principal({ role: 'member' }))
    expect((await getBootstrapData()).primaryAdminUrl).toBe('https://acme.com/admin')
  })

  it('leaves the session portal scope, and its role a portal user’s', async () => {
    const data = await getBootstrapData()
    expect(data.session?.session.scope).toBe('portal')
    expect(data.userRole).toBe('user')
  })

  it('sends nothing to a portal user', async () => {
    hoisted.getRequestPrincipal.mockResolvedValue(principal({ role: 'user' }))
    expect('primaryAdminUrl' in (await getBootstrapData())).toBe(false)
  })

  it('sends nothing to an anonymous visitor', async () => {
    hoisted.getRequestPrincipal.mockResolvedValue(principal({ role: 'user', type: 'anonymous' }))
    expect('primaryAdminUrl' in (await getBootstrapData())).toBe(false)
  })

  it('sends nothing to a visitor who is not signed in', async () => {
    hoisted.cookie = null
    expect('primaryAdminUrl' in (await getBootstrapData())).toBe(false)
    hoisted.cookie = 'better-auth.session_token=tok'
    hoisted.getRequestSession.mockResolvedValue(null)
    expect('primaryAdminUrl' in (await getBootstrapData())).toBe(false)
  })

  it('sends nothing to a blocked principal, whatever its role', async () => {
    hoisted.getRequestPrincipal.mockResolvedValue(
      principal({ blockedAt: new Date('2026-11-02T00:00:00.000Z') })
    )
    expect('primaryAdminUrl' in (await getBootstrapData())).toBe(false)
  })

  it('sends nothing to a widget session', async () => {
    hoisted.getRequestSession.mockResolvedValue(signedIn('widget'))
    expect('primaryAdminUrl' in (await getBootstrapData())).toBe(false)
  })

  it('sends nothing on the primary domain, where the role already says it', async () => {
    hoisted.host = 'acme.com'
    hoisted.getRequestSession.mockResolvedValue(signedIn('dashboard'))
    const data = await getBootstrapData()
    expect('primaryAdminUrl' in data).toBe(false)
    expect(data.userRole).toBe('admin')
  })
})

describe('a help center domain that is the primary domain', () => {
  // Set before section domains, when nothing refused BASE_URL's host. The
  // primary domain must not become the help center's host: `/` stays the
  // feedback home, and the page is not told it is on a section's host.
  beforeEach(() => {
    hoisted.host = 'acme.com'
    hoisted.getWorkspaceSettings.mockResolvedValue({
      ...settings,
      portalConfig: {},
      helpCenterConfig: { domain: { domain: 'acme.com', verifiedAt: '2026-11-01T00:00:00.000Z' } },
      featureFlags: { feedback: true, helpCenter: true },
    })
  })

  it('shows the feedback home at / and says nothing about a section host', async () => {
    const data = (await getBootstrapData()) as Bootstrap & {
      sectionHome: string | null
      sectionLinks?: unknown
    }
    expect(data.sectionHome).toBeNull()
    expect(data.sectionLinks).toBeUndefined()
    expect('primaryAdminUrl' in data).toBe(false)
  })
})
