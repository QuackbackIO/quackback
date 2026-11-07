import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  openaiApiKey: undefined as string | undefined,
  openaiBaseUrl: undefined as string | undefined,
  anthropicApiKey: undefined as string | undefined,
  aiChatModel: undefined as string | undefined,
  aiEmbeddingModel: undefined as string | undefined,
  aiAssistantModel: undefined as string | undefined,
  aiDesignModel: undefined as string | undefined,
  aiSummaryModel: undefined as string | undefined,
}))

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

import { getChatModel, getEmbeddingModel, type ChatFeature } from '../models'

const FEATURES: ChatFeature[] = [
  'summary',
  'sentiment',
  'extraction',
  'qualityGate',
  'interpretation',
  'merge',
  'helpCenterAnswers',
  'helpCenterTranslate',
  'assistant',
  'inboxTranslation',
  'classification',
  'design',
]

beforeEach(() => {
  for (const key of Object.keys(mockConfig) as Array<keyof typeof mockConfig>) {
    mockConfig[key] = undefined
  }
})

describe('model defaults per provider', () => {
  it('the Claude API defaults every chat feature to Claude Haiku 5.5', () => {
    mockConfig.anthropicApiKey = 'sk-ant'
    for (const feature of FEATURES) expect(getChatModel(feature)).toBe('claude-haiku-5-5')
  })

  it('the Claude API honours AI_CHAT_MODEL and per-feature variables, and their off switch', () => {
    mockConfig.anthropicApiKey = 'sk-ant'
    mockConfig.aiChatModel = 'claude-sonnet-5-5'
    mockConfig.aiDesignModel = 'claude-haiku-5-5'
    mockConfig.aiSummaryModel = 'off'
    expect(getChatModel('assistant')).toBe('claude-sonnet-5-5')
    expect(getChatModel('design')).toBe('claude-haiku-5-5')
    expect(getChatModel('summary')).toBeNull()
  })

  it('an OpenAI-compatible endpoint has no default model', () => {
    mockConfig.openaiApiKey = 'sk'
    mockConfig.openaiBaseUrl = 'https://x/v1'
    for (const feature of FEATURES) expect(getChatModel(feature)).toBeNull()
  })

  it('both keys set gives no default either (AI is off)', () => {
    mockConfig.openaiApiKey = 'sk'
    mockConfig.openaiBaseUrl = 'https://x/v1'
    mockConfig.anthropicApiKey = 'sk-ant'
    expect(getChatModel('design')).toBeNull()
  })

  it('embeddings are off on the Claude API even when AI_EMBEDDING_MODEL is set', () => {
    mockConfig.anthropicApiKey = 'sk-ant'
    mockConfig.aiEmbeddingModel = 'text-embedding-3-small'
    expect(getEmbeddingModel()).toBeNull()
  })

  it('embeddings follow AI_EMBEDDING_MODEL on the OpenAI-compatible endpoint', () => {
    mockConfig.openaiApiKey = 'sk'
    mockConfig.openaiBaseUrl = 'https://x/v1'
    mockConfig.aiEmbeddingModel = 'text-embedding-3-small'
    expect(getEmbeddingModel()).toBe('text-embedding-3-small')
  })
})
