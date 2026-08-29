import { describe, expect, it } from 'vitest'
import {
  channelCloseActionLabel,
  channelCloseToast,
  channelReplyPlaceholder,
  channelShowsEndConversation,
} from '../index'

describe('channel close copy', () => {
  it('uses issue verbs on GitHub and conversation verbs elsewhere', () => {
    expect(channelCloseActionLabel('github', false)).toBe('Close issue')
    expect(channelCloseActionLabel('github', true)).toBe('Reopen issue')
    expect(channelCloseActionLabel('email', false)).toBe('Close')
    expect(channelCloseActionLabel('messenger', true)).toBe('Reopen')
    expect(channelCloseToast('github', true)).toBe('Issue closed')
    expect(channelCloseToast('email', true)).toBe('Conversation closed')
  })

  it('hides End conversation on native-close channels', () => {
    expect(channelShowsEndConversation('github')).toBe(false)
    expect(channelShowsEndConversation('email')).toBe(true)
    expect(channelShowsEndConversation('messenger')).toBe(true)
  })

  it('lets agents comment on a closed GitHub issue', () => {
    expect(channelReplyPlaceholder('github', { closed: true, isTicket: false })).toBe(
      'Comment on the closed issue…'
    )
    expect(channelReplyPlaceholder('email', { closed: true, isTicket: false })).toBe(
      'Type your reply…'
    )
  })
})
