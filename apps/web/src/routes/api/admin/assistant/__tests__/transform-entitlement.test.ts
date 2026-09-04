/**
 * The plan gate on AI drafting help, driven through a real drafting route
 * rather than through the shared gate in isolation, so the test proves the gate
 * is ON the path:
 *
 *   POST /api/admin/assistant/transform -> gateCopilotAguiRequest
 *     -> requireEntitlement -> getCloudConfig -> getWorkspaceSettings
 *     -> resolveCloudConfig -> refuse (402) or run the transform
 *
 * Both directions per fixture, plus the cloud-off fixture, because
 * `isEntitled()` grants everything when cloud is absent and a fixture that
 * forgot to enable cloud would pass against unwired code.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ENTITLEMENT_KEYS,
  PLAN_CATALOGUE,
  type PlanId,
} from '@/lib/server/domains/settings/cloud/cloud.types'
import { PROJECTED_LIMIT_KEYS } from '@/lib/server/domains/settings/cloud/billing-projection'

const mockRequireAuth = vi.fn()
const mockPolicyActorFromAuth = vi.fn()
vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  policyActorFromAuth: (...args: unknown[]) => mockPolicyActorFromAuth(...args),
}))

const mockIsAssistantConfigured = vi.fn()
const mockRunCopilotTransform = vi.fn()
vi.mock('@/lib/server/domains/assistant', () => ({
  isAssistantConfigured: (...args: unknown[]) => mockIsAssistantConfigured(...args),
  runCopilotTransform: (...args: unknown[]) => mockRunCopilotTransform(...args),
}))

const mockIsFeatureEnabled = vi.fn()
const mockGetWorkspaceSettings = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  getWorkspaceSettings: (...args: unknown[]) => mockGetWorkspaceSettings(...args),
}))

const mockAssertConversationViewable = vi.fn()
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  assertConversationViewable: (...args: unknown[]) => mockAssertConversationViewable(...args),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: vi.fn(async () => [{ id: 'ticket_1' }]) })),
        })),
      })),
    },
  }
})

import { handleTransform } from '../transform'
import { generateId } from '@quackback/ids'

const CONVERSATION_ID = generateId('conversation')
const PRINCIPAL_ID = 'principal_1'
const SOURCE_TEXT = 'Thanks for reaching out, we will look into it.'

function makeRequest(): Request {
  return new Request('http://localhost/api/admin/assistant/transform', {
    method: 'POST',
    body: JSON.stringify({
      threadId: 'thread-test',
      runId: 'run-test',
      messages: [{ id: 't', role: 'user', content: SOURCE_TEXT }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: { conversationId: CONVERSATION_ID, transform: 'more_friendly' },
    }),
  })
}

const NULL_LIMITS = Object.fromEntries(PROJECTED_LIMIT_KEYS.map((key) => [key, null])) as Record<
  (typeof PROJECTED_LIMIT_KEYS)[number],
  null
>

/**
 * Build the stored cloud block the resolver actually accepts: commercial state
 * arrives only as a full control-plane projection, so a plan-shaped stub would
 * resolve to disabled and this suite would pass against a broken gate.
 */
function withCloud(
  cloud: { enabled: boolean; plan: string; entitlements?: Record<string, boolean> } | null
): void {
  let stored: unknown = null
  if (cloud) {
    const grants = new Set(PLAN_CATALOGUE[cloud.plan as PlanId].grants)
    stored = {
      enabled: cloud.enabled,
      projection: {
        version: 1,
        effectivePlan: cloud.plan,
        trialStartedAt: null,
        trialExpiresAt: null,
        subscriptionStatus: null,
        entitlements: {
          ...Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, grants.has(key)])),
          ...(cloud.entitlements ?? {}),
        },
        freeLimits: NULL_LIMITS,
        planLimits: NULL_LIMITS,
        planLimitsExpireAt: null,
        canUpgrade: true,
        canManageBilling: false,
        renewalAt: null,
        cancellationAt: null,
      },
    }
  }
  mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud: stored } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue({ principal: { id: PRINCIPAL_ID } })
  mockPolicyActorFromAuth.mockResolvedValue({ principalId: PRINCIPAL_ID })
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockIsAssistantConfigured.mockReturnValue(true)
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockAssertConversationViewable.mockResolvedValue({ id: CONVERSATION_ID })
  mockRunCopilotTransform.mockResolvedValue({ text: 'Rewritten.' })
})

describe('POST /api/admin/assistant/transform — no cloud config', () => {
  it.each([
    ['no cloud block at all', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('runs the transform with %s', async (_label, cloud) => {
    withCloud(cloud)
    const res = await handleTransform({ request: makeRequest() })
    expect(res.status).toBe(200)
    expect(mockRunCopilotTransform).toHaveBeenCalledOnce()
  })
})

describe('POST /api/admin/assistant/transform — plan gate', () => {
  it('refuses with 402 on a plan without the entitlement and names the plan that has it', async () => {
    withCloud({ enabled: true, plan: 'free' })

    const res = await handleTransform({ request: makeRequest() })

    expect(res.status).toBe(402)
    const body = (await res.json()) as {
      error: { code: string; message: string; details: Record<string, unknown> }
    }
    expect(body.error.code).toBe('ENTITLEMENT_REQUIRED')
    expect(body.error.message).toBe(
      'AI drafts are a Pro feature. Your workspace is on Free. Upgrade to Pro to enable it.'
    )
    expect(body.error.details).toMatchObject({
      error: 'entitlement_required',
      entitlement: 'aiDrafts',
      currentPlan: 'free',
      requiredPlan: 'growth',
      requiredPlanName: 'Pro',
    })
    // No model work was started.
    expect(mockRunCopilotTransform).not.toHaveBeenCalled()
    expect(mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('runs the transform on a plan that includes it', async () => {
    withCloud({ enabled: true, plan: 'growth' })
    const res = await handleTransform({ request: makeRequest() })
    expect(res.status).toBe(200)
    expect(mockRunCopilotTransform).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    withCloud({ enabled: true, plan: 'free', entitlements: { aiDrafts: true } })
    expect((await handleTransform({ request: makeRequest() })).status).toBe(200)

    withCloud({ enabled: true, plan: 'enterprise', entitlements: { aiDrafts: false } })
    expect((await handleTransform({ request: makeRequest() })).status).toBe(402)
  })
})
