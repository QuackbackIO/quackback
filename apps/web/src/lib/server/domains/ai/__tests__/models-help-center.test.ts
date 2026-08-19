import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  aiChatModel: undefined as string | undefined,
  aiHelpCenterModel: undefined as string | undefined,
  aiSummaryModel: undefined,
  aiSentimentModel: undefined,
  aiExtractionModel: undefined,
  aiQualityGateModel: undefined,
  aiInterpretationModel: undefined,
  aiMergeModel: undefined,
  aiEmbeddingModel: undefined,
}))

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

import { getChatModel } from '../models'

beforeEach(() => {
  mockConfig.aiChatModel = undefined
  mockConfig.aiHelpCenterModel = undefined
})

describe('getChatModel(helpCenterAnswers)', () => {
  it('rides the chat-model role default', () => {
    mockConfig.aiChatModel = 'some-chat-model'
    expect(getChatModel('helpCenterAnswers')).toBe('some-chat-model')
  })

  it('prefers the per-feature override', () => {
    mockConfig.aiChatModel = 'some-chat-model'
    mockConfig.aiHelpCenterModel = 'small-model'
    expect(getChatModel('helpCenterAnswers')).toBe('small-model')
  })

  it('is disabled when nothing is configured', () => {
    expect(getChatModel('helpCenterAnswers')).toBeNull()
  })

  it('can be disabled via the off sentinel while chat stays on', () => {
    mockConfig.aiChatModel = 'some-chat-model'
    mockConfig.aiHelpCenterModel = 'off'
    expect(getChatModel('helpCenterAnswers')).toBeNull()
  })
})
