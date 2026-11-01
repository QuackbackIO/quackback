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
  getOptionalAuth: vi.fn(),
  switchPreviewView: vi.fn(),
  handlers: [] as Array<(input: { data: unknown }) => Promise<unknown>>,
  validate: (data: unknown) => data,
}))

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    const builder = {
      validator(validate: (data: unknown) => unknown) {
        hoisted.validate = validate
        return builder
      },
      handler(fn: (input: { data: unknown }) => Promise<unknown>) {
        hoisted.handlers.push(fn)
        return fn
      },
    }
    return builder
  },
}))
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  getOptionalAuth: hoisted.getOptionalAuth,
}))
vi.mock('@/lib/server/domains/design/switch', () => ({
  switchPreviewView: hoisted.switchPreviewView,
}))
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers({ host: 'feedback.example' }),
  getRequestUrl: () => new URL('https://feedback.example/'),
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

async function getBootstrapData(input?: unknown) {
  if (hoisted.handlers.length === 0) await import('../bootstrap')
  return (await hoisted.handlers[0]!({ data: hoisted.validate(input) })) as {
    settings: {
      name: string
      settings: object
      statusConfig: object
      portalDesign?: { engine: string }
    } | null
    onboarding: { complete: boolean; needsSetupWizard: boolean }
  }
}

describe('getBootstrapData response', () => {
  beforeEach(() => {
    hoisted.getWorkspaceSettings.mockReset()
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
})

describe('the switch preview frame', () => {
  const switched = { engine: 'v2', attributes: {} }
  const editor = { scope: 'dashboard', permissions: ['settings.branding'] }

  beforeEach(() => {
    hoisted.getWorkspaceSettings.mockReset()
    hoisted.getWorkspaceSettings.mockResolvedValue(workspaceSettings(setupState()))
    hoisted.getOptionalAuth.mockReset()
    hoisted.switchPreviewView.mockReset()
    hoisted.switchPreviewView.mockResolvedValue(switched)
  })

  it('draws the portal switched for someone who can edit its branding', async () => {
    hoisted.getOptionalAuth.mockResolvedValue(editor)
    const data = await getBootstrapData({ designPreview: 'switch' })
    expect(data.settings?.portalDesign).toEqual(switched)
    expect(data.settings?.settings).toEqual({})
  })

  it('draws it as it is for anyone else, or for an unknown request', async () => {
    hoisted.getOptionalAuth.mockResolvedValue(null)
    expect(
      (await getBootstrapData({ designPreview: 'switch' })).settings?.portalDesign
    ).toBeUndefined()
    hoisted.getOptionalAuth.mockResolvedValue({ ...editor, permissions: ['posts.read'] })
    expect(
      (await getBootstrapData({ designPreview: 'switch' })).settings?.portalDesign
    ).toBeUndefined()
    hoisted.getOptionalAuth.mockResolvedValue({ ...editor, scope: 'widget' })
    expect(
      (await getBootstrapData({ designPreview: 'switch' })).settings?.portalDesign
    ).toBeUndefined()

    hoisted.getOptionalAuth.mockResolvedValue(editor)
    expect(
      (await getBootstrapData({ designPreview: 'other' })).settings?.portalDesign
    ).toBeUndefined()
    expect((await getBootstrapData()).settings?.portalDesign).toBeUndefined()
    expect(hoisted.switchPreviewView).toHaveBeenCalledTimes(0)
  })

  it('draws it as it is when there is nothing to switch', async () => {
    hoisted.getOptionalAuth.mockResolvedValue(editor)
    hoisted.switchPreviewView.mockResolvedValue(null)
    expect(
      (await getBootstrapData({ designPreview: 'switch' })).settings?.portalDesign
    ).toBeUndefined()
  })
})
