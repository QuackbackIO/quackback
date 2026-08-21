/**
 * Audit-log wiring for updateAuthConfigFn — emits one event per
 * password/magic-link toggle flip. No-op when those keys aren't in the
 * payload or when the new value matches the previous one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
        return chain
      },
      handler: (fn: AnyHandler) => fn,
    }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockUpdateAuthConfig: vi.fn(),
  mockGetAuthConfig: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.mockRecordAuditEvent,
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  updateAuthConfig: hoisted.mockUpdateAuthConfig,
  getAuthConfig: hoisted.mockGetAuthConfig,
  getWorkspaceSettings: vi.fn(),
  setVerifiedDomainEnforced: vi.fn(),
  listVerifiedDomains: vi.fn(),
  setSsoDomainSubtree: vi.fn(),
  getPortalConfig: vi.fn(),
  updatePortalConfig: vi.fn(),
  getDeveloperConfig: vi.fn(),
  updateDeveloperConfig: vi.fn(),
  getCustomCss: vi.fn(),
  updateCustomCss: vi.fn(),
  getBrandingConfig: vi.fn(),
  updateBrandingConfig: vi.fn(),
  getWidgetConfig: vi.fn(),
  updateWidgetConfig: vi.fn(),
  getHelpCenterConfig: vi.fn(),
  updateHelpCenterConfig: vi.fn(),
  fetchHeaderDisplayMode: vi.fn(),
  updateHeaderDisplayMode: vi.fn(),
  updateHeaderDisplayName: vi.fn(),
  updateWorkspaceName: vi.fn(),
  saveLogoKey: vi.fn(),
  deleteLogo: vi.fn(),
  saveHeaderLogoKey: vi.fn(),
  deleteHeaderLogo: vi.fn(),
  saveFaviconKey: vi.fn(),
  deleteFavicon: vi.fn(),
  fetchPortalConfig: vi.fn(),
  fetchPublicPortalConfig: vi.fn(),
  fetchPublicAuthConfig: vi.fn(),
  fetchUserProfile: vi.fn(),
  fetchTeamMembersAndInvitations: vi.fn(),
  fetchBrandingConfig: vi.fn(),
  fetchAuthConfig: vi.fn(),
  fetchDeveloperConfig: vi.fn(),
  fetchWidgetConfig: vi.fn(),
  fetchWidgetSecret: vi.fn(),
  fetchCustomCss: vi.fn(),
}))

// updateAuthConfigFn's last-method backstop calls the DB-backed sign-in-method
// check; stub it so these audit-wiring tests stay unit-level.
vi.mock('@/lib/server/auth/sign-in-method-availability', () => ({
  wouldLeaveNoWorkingSignInMethod: vi.fn(async () => false),
  // Default to "not SSO-only" so these audit tests exercise the happy path;
  // the break-glass precondition itself is covered in the availability suite.
  evaluateProposedSignInMethods: vi.fn(async () => ({
    leavesNoMethod: false,
    leavesSsoOnly: false,
  })),
  assertBreakGlassAvailable: vi.fn(async () => {}),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { id: 'principal_admin1', role: 'admin' },
  })
  hoisted.mockUpdateAuthConfig.mockImplementation(async (input) => ({
    oauth: { password: true, magicLink: true, ...input.oauth },
  }))
  // Default prior config — both toggles on.
  hoisted.mockGetAuthConfig.mockResolvedValue({
    oauth: { password: true, magicLink: true },
  })
  hoisted.mockRecordAuditEvent.mockResolvedValue(undefined)
})

// The mocked `.handler(fn)` returns the handler, so the export IS the function
// under test. By name, so reordering `settings.ts` cannot silently retarget it.
const { updateAuthConfigFn } = await import('../settings')
const updateAuthConfig = updateAuthConfigFn as unknown as AnyHandler

describe('updateAuthConfigFn audit-log wiring', () => {
  it('records auth.password.disabled when password flips from on to off', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({
      oauth: { password: true, magicLink: true },
    })

    await updateAuthConfig({ data: { oauth: { password: false } } })

    const events = hoisted.mockRecordAuditEvent.mock.calls.map((c) => c[0].event)
    expect(events).toContain('auth.password.disabled')
  })

  it('records auth.password.enabled when password flips from off to on', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({
      oauth: { password: false, magicLink: true },
    })

    await updateAuthConfig({ data: { oauth: { password: true } } })

    const events = hoisted.mockRecordAuditEvent.mock.calls.map((c) => c[0].event)
    expect(events).toContain('auth.password.enabled')
  })

  it('records auth.magic_link.disabled when magicLink flips from on to off', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({
      oauth: { password: true, magicLink: true },
    })

    await updateAuthConfig({ data: { oauth: { magicLink: false } } })

    const events = hoisted.mockRecordAuditEvent.mock.calls.map((c) => c[0].event)
    expect(events).toContain('auth.magic_link.disabled')
  })

  it('records BOTH events when both toggles flip in the same call', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({
      oauth: { password: true, magicLink: true },
    })

    await updateAuthConfig({ data: { oauth: { password: false, magicLink: false } } })

    const events = hoisted.mockRecordAuditEvent.mock.calls.map((c) => c[0].event)
    expect(events).toEqual(
      expect.arrayContaining(['auth.password.disabled', 'auth.magic_link.disabled'])
    )
  })

  it('does NOT record when toggle value is unchanged', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({
      oauth: { password: true, magicLink: true },
    })

    await updateAuthConfig({ data: { oauth: { password: true } } })

    const events = hoisted.mockRecordAuditEvent.mock.calls.map((c) => c[0].event)
    expect(events).not.toContain('auth.password.enabled')
    expect(events).not.toContain('auth.password.disabled')
  })

  it('does NOT record when oauth is absent from the payload', async () => {
    await updateAuthConfig({ data: { openSignup: true } })

    expect(hoisted.mockRecordAuditEvent).not.toHaveBeenCalled()
  })

  it('records a failure audit row when the underlying update throws', async () => {
    hoisted.mockUpdateAuthConfig.mockRejectedValueOnce(new Error('boom'))
    hoisted.mockGetAuthConfig.mockResolvedValue({
      oauth: { password: true, magicLink: true },
    })

    await expect(updateAuthConfig({ data: { oauth: { password: false } } })).rejects.toThrow()

    const call = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => c[0].event === 'auth.password.disabled'
    )
    expect(call).toBeDefined()
    expect(call?.[0].outcome).toBe('failure')
    expect(call?.[0].metadata).toMatchObject({ reason: 'boom' })
  })

  it('records sso.config.changed when ssoOidc fields are mutated', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({
      oauth: { password: true, magicLink: true },
      ssoOidc: { enabled: false, autoCreateUsers: false },
    })

    await updateAuthConfig({
      data: {
        ssoOidc: { enabled: true, autoCreateUsers: true },
      },
    })

    const ssoCall = hoisted.mockRecordAuditEvent.mock.calls.find(
      (c) => c[0].event === 'sso.config.changed'
    )
    expect(ssoCall).toBeDefined()
    expect(ssoCall?.[0].outcome).toBe('success')
    expect(ssoCall?.[0].metadata).toMatchObject({
      fields: expect.arrayContaining(['enabled', 'autoCreateUsers']),
    })
  })

  it('does NOT record sso.config.changed when no ssoOidc values changed', async () => {
    hoisted.mockGetAuthConfig.mockResolvedValue({
      oauth: { password: true },
      ssoOidc: { enabled: false },
    })

    await updateAuthConfig({ data: { ssoOidc: { enabled: false } } })

    const events = hoisted.mockRecordAuditEvent.mock.calls.map((c) => c[0].event)
    expect(events).not.toContain('sso.config.changed')
  })
})
