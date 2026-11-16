import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `getBootstrapData` is a server function: besides seeding the SSR document it
 * answers a plain GET from any browser, signed in or not, on every client-side
 * navigation. Whatever its handler returns is what goes over the wire, so the
 * server-only parts of the workspace settings must already be gone from it,
 * not stripped later by the route that asked.
 */

const hoisted = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  handlers: [] as Array<() => Promise<unknown>>,
  host: 'feedback.example',
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
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ host: hoisted.host }),
  getRequestUrl: () => new URL(`https://${hoisted.host}/`),
  getRequest: () => new Request(`https://${hoisted.host}/`, { headers: { host: hoisted.host } }),
  setResponseHeader: vi.fn(),
}))
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.getWorkspaceSettings,
}))
vi.mock('@/lib/server/auth/registered-providers', () => ({
  getRegisteredAuthProviders: async () => ['password'],
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://feedback.example' } }))
vi.mock('@/lib/server/domains/help-center/help-center-domain.service', () => ({
  resolveHelpCenterBaseUrl: ({ fallback }: { fallback: string }) => fallback,
}))
vi.mock('@/lib/server/process-role', () => ({ shouldRunWorkers: () => false }))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

const WIDGET_SECRET = 'wsec_must_not_leave_the_server'
const BILLING_REF = 'cus_must_not_leave_the_server'

function setupState(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 2,
    steps: {
      core: true,
      workspace: true,
      startingPoint: {
        outcome: 'product_feedback',
        resourceType: 'board',
        source: 'existing',
        resolution: 'configured',
        completedAt: '2026-09-01T00:00:00.000Z',
      },
    },
    completedAt: '2026-09-01T00:00:00.000Z',
    completionSource: 'wizard',
    ...overrides,
  })
}

function workspaceSettings(rawSetupState: string) {
  const portalConfig = {
    access: { visibility: 'private', allowedDomains: ['corp.example'], widgetSignIn: true },
  }
  return {
    // The raw settings row, as getWorkspaceSettings() carries it.
    settings: {
      id: 'workspace_1',
      name: 'Acme',
      slug: 'acme',
      widgetSecret: WIDGET_SECRET,
      setupState: rawSetupState,
      cloud: { billing: { customerRef: BILLING_REF } },
      tierLimits: { seats: 3 },
      metadata: '{"status":{"allowedSegmentIds":["seg_hidden"]}}',
      portalConfig: JSON.stringify(portalConfig),
    },
    name: 'Acme',
    slug: 'acme',
    portalConfig,
    statusConfig: {
      enabled: true,
      audience: 'public',
      pageDescription: 'All systems',
      allowedSegmentIds: ['seg_hidden'],
      emailsDisabled: true,
    },
    featureFlags: { feedback: true },
    managedFieldPaths: [],
  }
}

async function getBootstrapData() {
  if (hoisted.handlers.length === 0) await import('../bootstrap')
  return (await hoisted.handlers[0]!()) as {
    settings: { name: string; settings: object; statusConfig: object } | null
    onboarding: { complete: boolean; needsSetupWizard: boolean }
    sectionHome: string | null
    sectionLinks?: { hosts?: Record<string, string>; here?: string; primary?: string }
  }
}

describe('getBootstrapData response', () => {
  beforeEach(() => {
    hoisted.getWorkspaceSettings.mockReset()
    hoisted.host = 'feedback.example'
  })

  it('carries none of the server-only settings', async () => {
    hoisted.getWorkspaceSettings.mockResolvedValue(workspaceSettings(setupState()))

    const data = await getBootstrapData()
    const wire = JSON.stringify(data)

    expect(wire).not.toContain(WIDGET_SECRET)
    expect(wire).not.toContain(BILLING_REF)
    expect(wire).not.toContain('corp.example')
    expect(wire).not.toContain('seg_hidden')
    expect(data.settings?.settings).toEqual({})
    expect(data.settings?.statusConfig).toEqual({
      enabled: true,
      audience: 'public',
      pageDescription: 'All systems',
    })
    // The public parts still arrive.
    expect(data.settings?.name).toBe('Acme')
  })

  it('decides onboarding progress on the server', async () => {
    hoisted.getWorkspaceSettings.mockResolvedValue(workspaceSettings(setupState()))
    expect((await getBootstrapData()).onboarding).toEqual({
      complete: true,
      needsSetupWizard: false,
    })

    const unfinished = JSON.stringify({ version: 2, steps: { core: true } })
    hoisted.getWorkspaceSettings.mockResolvedValue(workspaceSettings(unfinished))
    expect((await getBootstrapData()).onboarding).toEqual({
      complete: false,
      needsSetupWizard: false,
    })

    const provisioned = setupState({ completionSource: 'managed' })
    hoisted.getWorkspaceSettings.mockResolvedValue(workspaceSettings(provisioned))
    expect((await getBootstrapData()).onboarding).toEqual({
      complete: true,
      needsSetupWizard: true,
    })
  })

  it('treats a workspace without settings as not onboarded', async () => {
    hoisted.getWorkspaceSettings.mockResolvedValue(null)

    const data = await getBootstrapData()

    expect(data.settings).toBeNull()
    expect(data.onboarding).toEqual({ complete: false, needsSetupWizard: false })
  })

  it("marks a section host's document with the page / shows there", async () => {
    const settings = workspaceSettings(setupState())
    hoisted.getWorkspaceSettings.mockResolvedValue({
      ...settings,
      portalConfig: {
        ...settings.portalConfig,
        sectionDomains: { help: { hostname: 'help.acme.com', verifiedAt: null } },
      },
      featureFlags: { feedback: true, helpCenter: true },
    })

    expect((await getBootstrapData()).sectionHome).toBeNull()
    hoisted.host = 'help.acme.com'
    expect((await getBootstrapData()).sectionHome).toBe('/hc')
  })

  it('tells the browser where each section is linked, on every host', async () => {
    const settings = workspaceSettings(setupState())
    hoisted.getWorkspaceSettings.mockResolvedValue({
      ...settings,
      portalConfig: {
        ...settings.portalConfig,
        sectionDomains: {
          help: { hostname: 'help.acme.com', verifiedAt: '2026-11-01T00:00:00.000Z' },
          // Not verified: links stay on the primary domain.
          status: { hostname: 'status.acme.com', verifiedAt: null },
        },
      },
      featureFlags: { feedback: true, helpCenter: true, statusPage: true },
      statusConfig: { enabled: true },
    })

    // Only the exception is sent: the help center's host. The page is on
    // the primary domain, which is its base URL.
    expect((await getBootstrapData()).sectionLinks).toEqual({
      hosts: { help: 'https://help.acme.com' },
    })

    hoisted.host = 'help.acme.com'
    expect((await getBootstrapData()).sectionLinks).toEqual({
      hosts: { help: 'https://help.acme.com' },
      here: 'https://help.acme.com',
    })
  })

  it('sends nothing about section hosts while no section has one', async () => {
    hoisted.getWorkspaceSettings.mockResolvedValue(workspaceSettings(setupState()))
    const data = await getBootstrapData()
    expect('sectionLinks' in data).toBe(false)
  })
})
