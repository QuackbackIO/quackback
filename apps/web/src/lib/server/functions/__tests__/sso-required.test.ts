/**
 * Tests for the workspace-wide SSO enforcement server fns:
 *
 *  - previewSsoRequiredImpactFn returns the counts the confirmation
 *    modal needs (team members without SSO, active non-SSO sessions,
 *    magic-link state, recovery-code state, portal users)
 *  - setSsoRequiredFn enforces bootstrap-guard + recovery-codes
 *    prerequisite on enable; revokes non-SSO sessions; auto-disables
 *    magic-link unless opt-in; audits success and failure
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  recordAuditEvent: vi.fn(),
  revokeFn: vi.fn(),
  updateAuthConfig: vi.fn(),
  getAuthConfig: vi.fn(),
  findFirstPrincipal: vi.fn(),
  findManyCodes: vi.fn(),
  countTeamWithoutSso: vi.fn(),
  countNonSsoSessions: vi.fn(),
  countPortalUsers: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.recordAuditEvent,
  actorFromAuth: (auth: { user: { id: string; email: string }; principal: { role: string } }) => ({
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
  }),
  withAuditEvent: async (
    spec: { event: string; metadata?: Record<string, unknown>; [k: string]: unknown },
    fn: () => Promise<unknown>
  ) => {
    try {
      const result = await fn()
      await hoisted.recordAuditEvent({
        ...spec,
        outcome: 'success',
        metadata: {
          ...(spec.metadata ?? {}),
          ...((result as { revokeCount?: number })?.revokeCount !== undefined
            ? { revokeCount: (result as { revokeCount?: number }).revokeCount }
            : {}),
        },
      })
      return result
    } catch (error) {
      const reason =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code: unknown }).code)
          : error instanceof Error
            ? error.message
            : 'UNEXPECTED'
      await hoisted.recordAuditEvent({
        ...spec,
        outcome: 'failure',
        metadata: { ...(spec.metadata ?? {}), reason },
      })
      throw error
    }
  },
}))

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => new Headers(),
}))

vi.mock('@/lib/server/auth/revoke-non-sso-sessions', () => ({
  revokeNonSsoTeamSessions: hoisted.revokeFn,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  updateAuthConfig: hoisted.updateAuthConfig,
  getAuthConfig: hoisted.getAuthConfig,
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: { findFirst: hoisted.findFirstPrincipal },
      ssoRecoveryCode: { findMany: hoisted.findManyCodes },
    },
    execute: vi.fn().mockResolvedValue({ rows: [{ count: 0 }] }),
  },
  principal: {},
  account: {},
  ssoRecoveryCode: {},
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: (strings: TemplateStringsArray) => ({ kind: 'sql', strings }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { id: 'principal_admin1', role: 'admin' },
  })
  hoisted.findFirstPrincipal.mockResolvedValue({ lastSsoSignInAt: new Date() })
  hoisted.findManyCodes.mockResolvedValue([{ id: 'rcode_1' }, { id: 'rcode_2' }])
  hoisted.getAuthConfig.mockResolvedValue({
    oauth: { password: true, magicLink: true },
    ssoOidc: { enabled: true, required: false },
  })
  hoisted.revokeFn.mockResolvedValue(3)
  hoisted.updateAuthConfig.mockResolvedValue(undefined)
})

await import('../sso-required')
const previewSsoRequiredImpact = handlers[0]
const setSsoRequired = handlers[1]

describe('previewSsoRequiredImpactFn', () => {
  it('requires admin role', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(previewSsoRequiredImpact({ data: {} })).rejects.toThrow('Access denied')
  })

  it('returns the shape the confirmation modal expects', async () => {
    const result = (await previewSsoRequiredImpact({ data: {} })) as {
      teamMembersWithoutSso: number
      activeNonSsoSessions: number
      magicLinkEnabled: boolean
      recoveryCodesGenerated: boolean
    }

    expect(result).toMatchObject({
      teamMembersWithoutSso: expect.any(Number),
      activeNonSsoSessions: expect.any(Number),
      magicLinkEnabled: true,
      recoveryCodesGenerated: true,
    })
  })

  it('reports recoveryCodesGenerated=false when actor has no active codes', async () => {
    hoisted.findManyCodes.mockResolvedValue([])
    const result = (await previewSsoRequiredImpact({ data: {} })) as {
      recoveryCodesGenerated: boolean
    }
    expect(result.recoveryCodesGenerated).toBe(false)
  })
})

describe('setSsoRequiredFn — enable', () => {
  it('rejects when actor lacks recent SSO sign-in (bootstrap guard)', async () => {
    hoisted.findFirstPrincipal.mockResolvedValue({ lastSsoSignInAt: null })

    await expect(setSsoRequired({ data: { required: true } })).rejects.toThrow(/SSO/i)
    expect(hoisted.updateAuthConfig).not.toHaveBeenCalled()
  })

  it('rejects when actor has no active recovery codes (hard prerequisite)', async () => {
    hoisted.findManyCodes.mockResolvedValue([])

    await expect(setSsoRequired({ data: { required: true } })).rejects.toThrow(/recovery/i)
    expect(hoisted.updateAuthConfig).not.toHaveBeenCalled()
  })

  it('persists required=true and auto-disables magicLink on enable', async () => {
    await setSsoRequired({ data: { required: true } })

    const updateCall = hoisted.updateAuthConfig.mock.calls[0][0]
    expect(updateCall.ssoOidc.required).toBe(true)
    expect(updateCall.oauth.magicLink).toBe(false)
  })

  it('keeps magicLink enabled when allowMagicLinkUnderRequired=true', async () => {
    await setSsoRequired({ data: { required: true, allowMagicLinkUnderRequired: true } })

    const updateCall = hoisted.updateAuthConfig.mock.calls[0][0]
    expect(updateCall.ssoOidc.required).toBe(true)
    expect(updateCall.ssoOidc.allowMagicLinkUnderRequired).toBe(true)
    // Magic-link is NOT touched in the update payload when the opt-in
    // is set — the opt-in's whole point is to leave it as the admin
    // previously configured it.
    expect(updateCall.oauth).toBeUndefined()
  })

  it('revokes non-SSO team sessions on enable', async () => {
    await setSsoRequired({ data: { required: true } })
    expect(hoisted.revokeFn).toHaveBeenCalledTimes(1)
  })

  it('emits sso.enforcement.workspace_required.enabled audit with revokeCount', async () => {
    await setSsoRequired({ data: { required: true } })

    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sso.enforcement.workspace_required.enabled',
        outcome: 'success',
        metadata: expect.objectContaining({ revokeCount: 3 }),
      })
    )
  })
})

describe('setSsoRequiredFn — disable', () => {
  it('persists required=false without bootstrap/recovery checks', async () => {
    hoisted.findFirstPrincipal.mockResolvedValue({ lastSsoSignInAt: null })
    hoisted.findManyCodes.mockResolvedValue([])

    await setSsoRequired({ data: { required: false } })

    expect(hoisted.updateAuthConfig).toHaveBeenCalledWith(
      expect.objectContaining({ ssoOidc: expect.objectContaining({ required: false }) })
    )
  })

  it('does NOT revoke sessions on disable', async () => {
    await setSsoRequired({ data: { required: false } })
    expect(hoisted.revokeFn).not.toHaveBeenCalled()
  })

  it('emits sso.enforcement.workspace_required.disabled audit', async () => {
    await setSsoRequired({ data: { required: false } })

    expect(hoisted.recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'sso.enforcement.workspace_required.disabled',
        outcome: 'success',
      })
    )
  })
})
