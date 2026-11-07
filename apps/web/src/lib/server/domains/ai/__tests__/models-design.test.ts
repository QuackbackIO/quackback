import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  aiChatModel: undefined as string | undefined,
  aiAssistantModel: undefined as string | undefined,
  aiDesignModel: undefined as string | undefined,
}))

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

import { getChatModel } from '../models'

beforeEach(() => {
  mockConfig.aiChatModel = undefined
  mockConfig.aiAssistantModel = undefined
  mockConfig.aiDesignModel = undefined
})

describe('getChatModel(design)', () => {
  it('rides the assistant’s model, then the chat default', () => {
    mockConfig.aiChatModel = 'chat-model'
    expect(getChatModel('design')).toBe('chat-model')
    mockConfig.aiAssistantModel = 'assistant-model'
    expect(getChatModel('design')).toBe('assistant-model')
  })

  it('prefers its own model', () => {
    mockConfig.aiAssistantModel = 'assistant-model'
    mockConfig.aiDesignModel = 'design-model'
    expect(getChatModel('design')).toBe('design-model')
  })

  it('can be turned off on its own', () => {
    mockConfig.aiAssistantModel = 'assistant-model'
    mockConfig.aiDesignModel = 'off'
    expect(getChatModel('design')).toBeNull()
  })
})
