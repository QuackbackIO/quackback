/**
 * The plan gate on sentiment analysis (the sentiment half of AI insights),
 * driven through the real service entry point:
 *
 *   analyzeSentiment -> requireEntitlement -> getCloudConfig
 *     -> getWorkspaceSettings -> resolveCloudConfig -> refuse or classify
 *
 * The oracle for "allowed" is the model actually being called, not merely the
 * absence of a throw. Both directions per fixture, plus the cloud-off fixture,
 * because `isEntitled()` grants everything when cloud is absent and a fixture
 * that forgot to enable cloud would pass against unwired code.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'

const hoisted = vi.hoisted(() => ({
  mockGetWorkspaceSettings: vi.fn(),
  mockChat: vi.fn(),
  mockEnforceAiTokenBudget: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getWorkspaceSettings: hoisted.mockGetWorkspaceSettings,
}))

vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: hoisted.mockEnforceAiTokenBudget,
}))

vi.mock('@/lib/server/config', () => ({
  config: { openaiApiKey: 'test-key', openaiBaseUrl: 'http://localhost:9999/v1' },
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: vi.fn(() => true),
  structuredOutputProviderOptions: vi.fn(() => ({})),
}))

vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'ai-usage-logging' }),
}))

vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: () => 'test-model',
  getEmbeddingModel: () => 'test-embedding-model',
}))

vi.mock('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => hoisted.mockChat(...args),
}))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: vi.fn((...args: unknown[]) => ({ kind: 'text', args })),
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {},
  eq: vi.fn(),
}))

import { analyzeSentiment } from '../sentiment.service'

function withCloud(cloud: unknown): void {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockChat.mockResolvedValue({ sentiment: 'positive', confidence: 0.9 })
})

describe('analyzeSentiment — no cloud config', () => {
  it.each([
    ['no cloud block at all', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('classifies the post with %s', async (_label, cloud) => {
    withCloud(cloud)
    await expect(analyzeSentiment('Title', 'Great feature!')).resolves.toEqual({
      sentiment: 'positive',
      confidence: 0.9,
      model: 'test-model',
    })
    expect(hoisted.mockChat).toHaveBeenCalledOnce()
  })
})

describe('analyzeSentiment — plan gate', () => {
  it('refuses on a plan without the entitlement and names the plan that has it', async () => {
    withCloud(storedCloud('growth'))

    const refusal = await analyzeSentiment('Title', 'Great feature!').catch(
      (error: unknown) => error
    )

    expect(refusal).toBeInstanceOf(EntitlementRequiredError)
    const error = refusal as EntitlementRequiredError
    expect(error.entitlement).toBe('aiInsights')
    expect(error.requiredPlanName).toBe('Pro')
    expect(error.statusCode).toBe(402)
    expect(error.message).toBe(
      'AI insights are a Pro feature. Your workspace is on Growth. Upgrade to Pro to enable it.'
    )
    // No model call, no spend.
    expect(hoisted.mockChat).not.toHaveBeenCalled()
    expect(hoisted.mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('classifies the post on a plan that includes it', async () => {
    withCloud(storedCloud('pro'))
    await expect(analyzeSentiment('Title', 'Great feature!')).resolves.toMatchObject({
      sentiment: 'positive',
    })
    expect(hoisted.mockChat).toHaveBeenCalledOnce()
    expect(hoisted.mockEnforceAiTokenBudget).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    withCloud(storedCloud('free', { aiInsights: true }))
    await expect(analyzeSentiment('Title', 'Great feature!')).resolves.toMatchObject({
      sentiment: 'positive',
    })

    withCloud(storedCloud('scale', { aiInsights: false }))
    await expect(analyzeSentiment('Title', 'Great feature!')).rejects.toBeInstanceOf(
      EntitlementRequiredError
    )
  })
})
