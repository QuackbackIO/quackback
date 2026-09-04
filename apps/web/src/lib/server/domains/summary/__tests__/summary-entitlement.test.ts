/**
 * The plan gate on post summaries (the summary half of AI insights), driven
 * through the real service entry point:
 *
 *   generateAndSavePostSummary -> requireEntitlement -> getCloudConfig
 *     -> getWorkspaceSettings -> resolveCloudConfig -> refuse or generate
 *
 * The oracle for "allowed" is the model actually being called and the summary
 * written, not merely the absence of a throw. Both directions per fixture, plus
 * the cloud-off fixture, because `isEntitled()` grants everything when cloud is
 * absent and a fixture that forgot to enable cloud would pass against unwired
 * code.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { storedCloud } from '@/lib/server/domains/settings/cloud/__tests__/cloud-fixture'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'
import type { PostId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  mockGetWorkspaceSettings: vi.fn(),
  mockFindFirst: vi.fn(),
  mockChat: vi.fn(),
  mockUpdate: vi.fn(),
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
  db: {
    query: { posts: { findFirst: (...a: unknown[]) => hoisted.mockFindFirst(...a) } },
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) }),
    update: (...a: unknown[]) => {
      hoisted.mockUpdate(...a)
      return { set: () => ({ where: () => Promise.resolve() }) }
    },
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}))

import { generateAndSavePostSummary } from '../summary.service'

const POST_ID = 'post_x' as PostId

function withCloud(cloud: unknown): void {
  hoisted.mockGetWorkspaceSettings.mockResolvedValue({ settings: { id: 'ws_1', cloud } })
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockFindFirst.mockResolvedValue({
    title: 'CSV export drops columns',
    content: 'Half our columns vanish.',
    summaryJson: null,
  })
  hoisted.mockChat.mockResolvedValue({ summary: 'A brief', keyQuotes: [], nextSteps: [] })
})

describe('generateAndSavePostSummary — no cloud config', () => {
  it.each([
    ['no cloud block at all', null],
    ['an explicitly disabled block', { enabled: false, plan: 'free' }],
  ])('summarises the post with %s', async (_label, cloud) => {
    withCloud(cloud)
    await expect(generateAndSavePostSummary(POST_ID)).resolves.toBeUndefined()
    expect(hoisted.mockChat).toHaveBeenCalledOnce()
    expect(hoisted.mockUpdate).toHaveBeenCalledOnce()
  })
})

describe('generateAndSavePostSummary — plan gate', () => {
  it('refuses on a plan without the entitlement and names the plan that has it', async () => {
    withCloud(storedCloud('free'))

    const refusal = await generateAndSavePostSummary(POST_ID).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EntitlementRequiredError)
    const error = refusal as EntitlementRequiredError
    expect(error.entitlement).toBe('aiInsights')
    expect(error.requiredPlanName).toBe('Pro')
    expect(error.statusCode).toBe(402)
    expect(error.message).toBe(
      'AI insights are a Pro feature. Your workspace is on Free. Upgrade to Pro to enable it.'
    )
    // No model call, no spend, nothing written.
    expect(hoisted.mockChat).not.toHaveBeenCalled()
    expect(hoisted.mockUpdate).not.toHaveBeenCalled()
    // The plan question is answered before the budget question, so a gated
    // workspace never pays for the usage read either.
    expect(hoisted.mockEnforceAiTokenBudget).not.toHaveBeenCalled()
  })

  it('summarises the post on a plan that includes it', async () => {
    withCloud(storedCloud('growth'))
    await expect(generateAndSavePostSummary(POST_ID)).resolves.toBeUndefined()
    expect(hoisted.mockChat).toHaveBeenCalledOnce()
    expect(hoisted.mockUpdate).toHaveBeenCalledOnce()
    expect(hoisted.mockEnforceAiTokenBudget).toHaveBeenCalledOnce()
  })

  it('honours an explicit override in either direction', async () => {
    withCloud(storedCloud('free', { aiInsights: true }))
    await expect(generateAndSavePostSummary(POST_ID)).resolves.toBeUndefined()
    expect(hoisted.mockChat).toHaveBeenCalledOnce()

    withCloud(storedCloud('scale', { aiInsights: false }))
    await expect(generateAndSavePostSummary(POST_ID)).rejects.toBeInstanceOf(
      EntitlementRequiredError
    )
  })
})
