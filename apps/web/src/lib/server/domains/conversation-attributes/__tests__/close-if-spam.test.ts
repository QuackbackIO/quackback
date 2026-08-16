import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId } from '@quackback/ids'

const { getWorkflowCloseSpamSettings, setConversationStatus } = vi.hoisted(() => ({
  getWorkflowCloseSpamSettings: vi.fn(async () => ({ enabled: false })),
  setConversationStatus: vi.fn(async () => ({})),
}))

vi.mock('@/lib/server/domains/settings/settings.workflows', () => ({
  getWorkflowCloseSpamSettings,
}))
vi.mock('@/lib/server/domains/conversation/conversation.service', () => ({
  setConversationStatus,
}))

import { isSpamClassification, maybeCloseConversationIfSpamClassified } from '../close-if-spam'

const conversationId = 'conversation_1' as ConversationId

beforeEach(() => {
  getWorkflowCloseSpamSettings.mockReset()
  getWorkflowCloseSpamSettings.mockResolvedValue({ enabled: true })
  setConversationStatus.mockReset()
  setConversationStatus.mockResolvedValue({})
})

describe('isSpamClassification', () => {
  it('matches key spam and option label Spam', () => {
    expect(isSpamClassification([{ key: 'spam', optionLabel: 'Spam' }])).toBe(true)
  })

  it('does not fire for Legit', () => {
    expect(isSpamClassification([{ key: 'spam', optionLabel: 'Legit' }])).toBe(false)
  })
})

describe('maybeCloseConversationIfSpamClassified', () => {
  it('closes via a service actor when spam is classified and the setting is on', async () => {
    await maybeCloseConversationIfSpamClassified(conversationId, [
      { key: 'spam', optionLabel: 'Spam' },
    ])
    expect(setConversationStatus).toHaveBeenCalledTimes(1)
    expect(setConversationStatus).toHaveBeenCalledWith(
      conversationId,
      'closed',
      expect.objectContaining({ principalType: 'service' })
    )
  })

  it('does not fire when classified as Legit', async () => {
    await maybeCloseConversationIfSpamClassified(conversationId, [
      { key: 'spam', optionLabel: 'Legit' },
    ])
    expect(getWorkflowCloseSpamSettings).not.toHaveBeenCalled()
    expect(setConversationStatus).not.toHaveBeenCalled()
  })

  it('does not fire when the setting is off', async () => {
    getWorkflowCloseSpamSettings.mockResolvedValueOnce({ enabled: false })
    await maybeCloseConversationIfSpamClassified(conversationId, [
      { key: 'spam', optionLabel: 'Spam' },
    ])
    expect(setConversationStatus).not.toHaveBeenCalled()
  })

  it.todo(
    'W3: a service-actored close-spam resumes a parked assistant wait down the escalated edge'
  )
})
