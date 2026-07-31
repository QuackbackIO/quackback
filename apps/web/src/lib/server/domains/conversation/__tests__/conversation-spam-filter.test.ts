/**
 * Inbound spam classification (conversation.spam-filter): a conservative
 * one-shot verdict over a new conversation's first message. Gates covered:
 * trusted-sender bypass (no model call at all); AI client or model
 * unconfigured -> not spam; token-budget exhaustion -> not spam; model
 * failure / malformed output -> not spam (the filter only ever ADDS a spam
 * filing, so every failure degrades to the triage queue). Pure unit test —
 * the post-autotag mocking idiom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

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

const mockGetChatModel = vi.fn((_feature?: string): string | null => 'test-classify-model')
vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: (feature: string) => mockGetChatModel(feature),
}))

const mockEnforceAiTokenBudget = vi.fn()
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: (...args: unknown[]) => mockEnforceAiTokenBudget(...args),
}))

const mockGetSpamFilterConfig = vi.fn(
  (): Promise<{ trustedSenders: string[] }> => Promise.resolve({ trustedSenders: [] })
)
vi.mock('@/lib/server/domains/settings/settings.spam', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/domains/settings/settings.spam')>()),
  getSpamFilterConfig: () => mockGetSpamFilterConfig(),
}))

import { classifyInboundAsSpam } from '../conversation.spam-filter'

const input = {
  senderEmail: 'sender@example.com',
  subject: 'Question about my order',
  content: 'Where is my invoice for last month?',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockConfig.openaiApiKey = 'test-key'
  mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
  mockGetChatModel.mockReturnValue('test-classify-model')
  mockGetSpamFilterConfig.mockResolvedValue({ trustedSenders: [] })
  mockEnforceAiTokenBudget.mockResolvedValue(undefined)
  mockChat.mockResolvedValue({ spam: false })
})

describe('classifyInboundAsSpam', () => {
  it('returns true when the classifier verdict is spam', async () => {
    mockChat.mockResolvedValue({ spam: true })
    await expect(classifyInboundAsSpam(input)).resolves.toBe(true)
    expect(mockChat).toHaveBeenCalledTimes(1)
  })

  it('returns false for a legitimate message', async () => {
    mockChat.mockResolvedValue({ spam: false })
    await expect(classifyInboundAsSpam(input)).resolves.toBe(false)
  })

  it('bypasses classification entirely for a trusted sender', async () => {
    mockGetSpamFilterConfig.mockResolvedValue({ trustedSenders: ['example.com'] })
    mockChat.mockResolvedValue({ spam: true })
    await expect(classifyInboundAsSpam(input)).resolves.toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('fails open when the trusted-sender list cannot be read', async () => {
    mockGetSpamFilterConfig.mockRejectedValue(new Error('settings row missing'))
    mockChat.mockResolvedValue({ spam: true })
    await expect(classifyInboundAsSpam(input)).resolves.toBe(true)
  })

  it('returns false when the AI client is unconfigured', async () => {
    mockConfig.openaiApiKey = undefined
    await expect(classifyInboundAsSpam(input)).resolves.toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('returns false when no classification model is set', async () => {
    mockGetChatModel.mockReturnValue(null)
    await expect(classifyInboundAsSpam(input)).resolves.toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('returns false when the AI token budget is exhausted', async () => {
    mockEnforceAiTokenBudget.mockRejectedValue(
      new TierLimitError({ limit: 'ai_tokens', message: 'budget exceeded' })
    )
    await expect(classifyInboundAsSpam(input)).resolves.toBe(false)
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('returns false when the completion throws', async () => {
    mockChat.mockRejectedValue(new Error('provider down'))
    await expect(classifyInboundAsSpam(input)).resolves.toBe(false)
  })

  it('returns false on a malformed model response', async () => {
    mockChat.mockResolvedValue({ unexpected: 'shape' })
    await expect(classifyInboundAsSpam(input)).resolves.toBe(false)
  })
})
