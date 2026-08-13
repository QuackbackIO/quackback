/**
 * The plan gate on the audit log, driven through the real server function:
 *
 *   listAuditEventsFn -> requireAuth -> requireEntitlement -> getCloudConfig
 *     -> getWorkspaceSettings -> resolveCloudConfig -> refuse or query
 *
 * Both directions per fixture, plus the cloud-off fixture: `isEntitled()`
 * grants everything when cloud is absent, so a test that only enabled cloud in
 * the refusal case would pass against unwired code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'

type AnyHandler = (args: { data: Record<string, unknown> }) => Promise<unknown>
const handlers: AnyHandler[] = []

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = {
      validator() {
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
  mockRequireAuth: vi.fn(),
  mockGetWorkspaceSettings: vi.fn(),
  mockQueryAuditEvents: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.mockRequireAuth,
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

vi.mock('@/lib/server/audit/log', () => ({
  queryAuditEvents: hoisted.mockQueryAuditEvents,
}))

await import('../audit-log')
const listAuditEvents = handlers[0]

function withCloud(cloud: unknown): void {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockRequireAuth.mockResolvedValue({
    user: { id: 'user_admin1', email: 'admin@example.com' },
    principal: { role: 'admin' },
  })
  hoisted.mockQueryAuditEvents.mockResolvedValue([
    { id: 'audit_1', eventType: 'sso.config.changed' },
  ])
})

describe('listAuditEventsFn — no cloud config', () => {
  it.each([
    ['no cloud block at all', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('returns events with %s', async (_label, cloud) => {
    withCloud(cloud)
    await expect(listAuditEvents({ data: {} })).resolves.toEqual({
      events: [{ id: 'audit_1', eventType: 'sso.config.changed' }],
      hasMore: false,
    })
    expect(hoisted.mockQueryAuditEvents).toHaveBeenCalledOnce()
  })
})

describe('listAuditEventsFn — plan gate', () => {
  it('refuses on a plan without the entitlement and names the plan that has it', async () => {
    withCloud({ enabled: true, plan: 'pro' })

    const refusal = await listAuditEvents({ data: {} }).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EntitlementRequiredError)
    const error = refusal as EntitlementRequiredError
    expect(error.entitlement).toBe('auditLog')
    expect(error.requiredPlanName).toBe('Scale')
    expect(error.statusCode).toBe(402)
    expect(error.message).toBe(
      'The audit log is a Scale feature. Your workspace is on Pro. Upgrade to Scale to enable it.'
    )
    // No read happened.
    expect(hoisted.mockQueryAuditEvents).not.toHaveBeenCalled()
  })

  it('returns events on a plan that includes it', async () => {
    withCloud({ enabled: true, plan: 'scale' })
    await expect(listAuditEvents({ data: {} })).resolves.toMatchObject({ hasMore: false })
    expect(hoisted.mockQueryAuditEvents).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    withCloud({ enabled: true, plan: 'free', entitlements: { auditLog: true } })
    await expect(listAuditEvents({ data: {} })).resolves.toBeDefined()

    withCloud({ enabled: true, plan: 'scale', entitlements: { auditLog: false } })
    await expect(listAuditEvents({ data: {} })).rejects.toBeInstanceOf(EntitlementRequiredError)
  })

  it('refuses before the query even for an admin (the gate is not a permission check)', async () => {
    withCloud({ enabled: true, plan: 'growth' })
    await expect(listAuditEvents({ data: { limit: 10 } })).rejects.toBeInstanceOf(
      EntitlementRequiredError
    )
    expect(hoisted.mockRequireAuth).toHaveBeenCalledOnce()
    expect(hoisted.mockQueryAuditEvents).not.toHaveBeenCalled()
  })
})
