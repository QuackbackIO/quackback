import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/domains/ai/usage-counter', () => ({
  aiTokensThisMonth: vi.fn(),
}))

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: undefined as string | undefined,
  openaiBaseUrl: undefined as string | undefined,
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

vi.mock('@/lib/server/domains/ai/models', () => ({
  getChatModel: () => 'test-model',
  getEmbeddingModel: () => 'test-embedding-model',
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: { query: { posts: { findFirst: vi.fn() } } },
  eq: vi.fn(),
}))

import { analyzeSentiment } from '../sentiment.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { aiTokensThisMonth } from '@/lib/server/domains/ai/usage-counter'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('analyzeSentiment — token budget gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.openaiApiKey = undefined
    mockConfig.openaiBaseUrl = undefined
  })

  it('throws TierLimitError when budget exceeded', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, aiTokensPerMonth: 100 })
    vi.mocked(aiTokensThisMonth).mockResolvedValue(100)
    await expect(analyzeSentiment('t', 'c')).rejects.toBeInstanceOf(TierLimitError)
  })

  it('does not throw when below budget (OSS unlimited)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    // AI stays unconfigured (no api key/base url) so this exercises the
    // no-op path without touching the model, same as before.
    await expect(analyzeSentiment('t', 'c')).resolves.toBeNull()
    expect(mockChat).not.toHaveBeenCalled()
  })
})

describe('analyzeSentiment — model call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.openaiApiKey = 'test-key'
    mockConfig.openaiBaseUrl = 'http://localhost:9999/v1'
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
  })

  it('returns null without calling the model when AI is unconfigured', async () => {
    mockConfig.openaiApiKey = undefined
    const result = await analyzeSentiment('Title', 'Content')
    expect(result).toBeNull()
    expect(mockChat).not.toHaveBeenCalled()
  })

  it('returns the classified sentiment on a valid model response', async () => {
    mockChat.mockResolvedValue({ sentiment: 'positive', confidence: 0.9 })
    const result = await analyzeSentiment('Title', 'Great feature!', 'post_1')
    expect(result).toEqual({ sentiment: 'positive', confidence: 0.9, model: 'test-model' })
  })

  it('returns null when the model response is malformed (schema validation fails)', async () => {
    // With outputSchema, chat() validates and rejects on a non-conforming
    // response; the outer best-effort catch logs and returns null, matching
    // the old parse-and-validate branch's fallback.
    mockChat.mockRejectedValue(new Error('response did not match schema'))
    const result = await analyzeSentiment('Title', 'Content')
    expect(result).toBeNull()
  })
})
