import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockConfig = vi.hoisted(() => ({
  aiChatModel: undefined as string | undefined,
  aiClassificationModel: undefined as string | undefined,
}))

vi.mock('@/lib/server/config', () => ({ config: mockConfig }))

import { getChatModel } from '../models'

beforeEach(() => {
  mockConfig.aiChatModel = undefined
  mockConfig.aiClassificationModel = undefined
})

describe('getChatModel(classification)', () => {
  it('rides the chat-model role default', () => {
    mockConfig.aiChatModel = 'some-chat-model'
    expect(getChatModel('classification')).toBe('some-chat-model')
  })

  it('prefers the per-feature override', () => {
    mockConfig.aiChatModel = 'some-chat-model'
    mockConfig.aiClassificationModel = 'small-model'
    expect(getChatModel('classification')).toBe('small-model')
  })

  it('is disabled when nothing is configured', () => {
    expect(getChatModel('classification')).toBeNull()
  })

  it('can be disabled via the off sentinel while chat stays on', () => {
    mockConfig.aiChatModel = 'some-chat-model'
    mockConfig.aiClassificationModel = 'off'
    expect(getChatModel('classification')).toBeNull()
  })
})
