/**
 * "Draft descriptions" authoring assist (AI-ATTRIBUTES-PARITY-SPEC.md Phase
 * 3): one chat call that turns an attribute label + option labels into
 * applies-if/does-not-apply-if descriptions — the exact template competing
 * products' authoring docs tell admins to write themselves with an external
 * LLM. Mocking idiom mirrors ai-classification.service.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsFeatureEnabled = vi.fn()
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}))

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: 'test-key' as string | undefined,
  openaiBaseUrl: 'http://localhost:9999/v1' as string | undefined,
}))
vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

const mockChat = vi.fn()
vi.mock('@tanstack/ai', () => ({
  chat: (...args: unknown[]) => mockChat(...args),
}))
vi.mock('@tanstack/ai-openai/compatible', () => ({
  openaiCompatibleText: (...args: unknown[]) => ({ kind: 'text', args }),
}))

vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: (apiKey?: string, baseUrl?: string) => Boolean(apiKey) && Boolean(baseUrl),
  structuredOutputProviderOptions: () => ({}),
}))

vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: () => ({ name: 'ai-usage-logging' }),
}))

const mockGetChatModel = vi.fn((_feature?: string): string | null => 'test-classification-model')
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (feature: string) => mockGetChatModel(feature),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

import { draftAttributeDescriptions } from '../attribute-description-draft.service'

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockIsFeatureEnabled.mockResolvedValue(true)
  mockGetChatModel.mockReturnValue('test-classification-model')
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
})

describe('draftAttributeDescriptions: gating', () => {
  it('throws when AI is not configured', async () => {
    mockConfig.openaiApiKey = undefined
    await expect(
      draftAttributeDescriptions({ label: 'Issue type', optionLabels: ['Billing'] })
    ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
  })

  it('rejects an empty label', async () => {
    await expect(
      draftAttributeDescriptions({ label: '   ', optionLabels: ['Billing'] })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('rejects zero option labels', async () => {
    await expect(
      draftAttributeDescriptions({ label: 'Issue type', optionLabels: [] })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

describe('draftAttributeDescriptions: happy path', () => {
  it('returns an attribute description and one description per option, in the given order', async () => {
    mockChat.mockResolvedValue({
      attributeDescription: 'What kind of issue the customer has.',
      options: [
        { label: 'Bug report', description: 'Applies when something is broken.' },
        { label: 'Billing', description: 'Applies when the customer asks about a charge.' },
      ],
    })
    const result = await draftAttributeDescriptions({
      label: 'Issue type',
      optionLabels: ['Billing', 'Bug report'],
    })
    expect(result.attributeDescription).toBe('What kind of issue the customer has.')
    // Re-ordered to match the INPUT optionLabels order, not the model's order.
    expect(result.options).toEqual([
      { label: 'Billing', description: 'Applies when the customer asks about a charge.' },
      { label: 'Bug report', description: 'Applies when something is broken.' },
    ])
  })

  it('falls back to an empty description for an option the model omitted', async () => {
    mockChat.mockResolvedValue({
      attributeDescription: 'desc',
      options: [{ label: 'Billing', description: 'x' }],
    })
    const result = await draftAttributeDescriptions({
      label: 'Issue type',
      optionLabels: ['Billing', 'Bug report'],
    })
    expect(result.options).toEqual([
      { label: 'Billing', description: 'x' },
      { label: 'Bug report', description: '' },
    ])
  })

  it('throws on a malformed model response (options missing entirely)', async () => {
    // Simulates what the permissive outputSchema reduces a shape-mismatched
    // response down to: the outer `.catch` fallback of `{ options: undefined }`.
    mockChat.mockResolvedValue({ options: undefined })
    await expect(
      draftAttributeDescriptions({ label: 'Issue type', optionLabels: ['Billing'] })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('propagates a hard call failure (network/provider error) rather than swallowing it', async () => {
    mockChat.mockRejectedValue(new Error('upstream error'))
    await expect(
      draftAttributeDescriptions({ label: 'Issue type', optionLabels: ['Billing'] })
    ).rejects.toThrow('upstream error')
  })
})
