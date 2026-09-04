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

import { ENTITLEMENT_KEYS, PLAN_CATALOGUE } from '@/lib/server/domains/settings/cloud/cloud.types'

const LIMITS = {
  maxBoards: 25,
  maxPosts: 1_000,
  maxTeamSeats: 10,
  maxStatusComponents: 25,
  maxCustomRoles: 5,
  maxSendingDomains: 3,
  aiTokensPerMonth: 100_000,
  apiRequestsPerMonth: 100_000,
  apiRequestsPerMinute: 600,
}

function storedCloud(
  plan: 'free' | 'growth' | 'business' | 'enterprise',
  entitlements?: Partial<Record<(typeof ENTITLEMENT_KEYS)[number], boolean>>
) {
  const grants = new Set(PLAN_CATALOGUE[plan].grants)
  return {
    enabled: true,
    projection: {
      version: 1,
      effectivePlan: plan,
      trialStartedAt: null,
      trialExpiresAt: null,
      subscriptionStatus: null,
      entitlements:
        entitlements ?? Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, grants.has(key)])),
      freeLimits: LIMITS,
      planLimits: LIMITS,
      planLimitsExpireAt: null,
      canUpgrade: true,
      canManageBilling: false,
      renewalAt: null,
      cancellationAt: null,
    },
  }
}

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
    withCloud(storedCloud('business'))

    const refusal = await listAuditEvents({ data: {} }).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EntitlementRequiredError)
    const error = refusal as EntitlementRequiredError
    expect(error.entitlement).toBe('auditLog')
    expect(error.requiredPlanName).toBe('Enterprise')
    expect(error.statusCode).toBe(402)
    expect(error.message).toBe(
      'The audit log is an Enterprise feature. Your workspace is on Business. Upgrade to Enterprise to enable it.'
    )
    // No read happened.
    expect(hoisted.mockQueryAuditEvents).not.toHaveBeenCalled()
  })

  it('returns events on a plan that includes it', async () => {
    withCloud(storedCloud('enterprise'))
    await expect(listAuditEvents({ data: {} })).resolves.toMatchObject({ hasMore: false })
    expect(hoisted.mockQueryAuditEvents).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    withCloud(storedCloud('free', { auditLog: true }))
    await expect(listAuditEvents({ data: {} })).resolves.toBeDefined()

    withCloud(storedCloud('enterprise', { auditLog: false }))
    await expect(listAuditEvents({ data: {} })).rejects.toBeInstanceOf(EntitlementRequiredError)
  })

  it('refuses before the query even for an admin (the gate is not a permission check)', async () => {
    withCloud(storedCloud('growth'))
    await expect(listAuditEvents({ data: { limit: 10 } })).rejects.toBeInstanceOf(
      EntitlementRequiredError
    )
    expect(hoisted.mockRequireAuth).toHaveBeenCalledOnce()
    expect(hoisted.mockQueryAuditEvents).not.toHaveBeenCalled()
  })
})
