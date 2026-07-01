import { describe, it, expect } from 'vitest'
import {
  applyVisitorReopenStatus,
  applyAgentReopenStatus,
  resolvedAtForStatus,
  shouldRequeueOnAgentOffline,
  unreadWatermarkFromAnchor,
  resolvedConversationRate,
} from '../conversation.lifecycle'
import { CONVERSATION_END_REASONS } from '@/lib/shared/conversation/types'

describe('unreadWatermarkFromAnchor', () => {
  const anchor = new Date('2026-06-03T12:00:00.000Z')
  const candidate = new Date(anchor.getTime() - 1) // just before the anchor

  it('re-surfaces an already-read message by moving the watermark back to just before it', () => {
    const current = new Date('2026-06-03T13:00:00.000Z') // anchor already read
    expect(unreadWatermarkFromAnchor(current, anchor)).toEqual(candidate)
  })

  it('is a no-op when the anchor is already in the unread region (never moves forward)', () => {
    // Watermark sits before the anchor → the anchor is already unread. Marking it
    // unread must NOT advance the watermark (that would re-mark earlier-unread
    // messages as read). Slack semantics: only ever move backward.
    const current = new Date('2026-06-03T11:00:00.000Z')
    expect(unreadWatermarkFromAnchor(current, anchor)).toEqual(current)
  })

  it('leaves a never-read conversation untouched (already fully unread)', () => {
    expect(unreadWatermarkFromAnchor(null, anchor)).toBeNull()
  })
})

describe('applyVisitorReopenStatus', () => {
  it('a visitor message always surfaces the thread (returns open)', () => {
    expect(applyVisitorReopenStatus()).toBe('open')
  })
})

describe('applyAgentReopenStatus', () => {
  it('reopens a closed thread but preserves pending', () => {
    expect(applyAgentReopenStatus('closed')).toBe('open')
    // An agent reply does NOT clear "waiting on customer" — only a visitor does.
    expect(applyAgentReopenStatus('pending')).toBe('pending')
    expect(applyAgentReopenStatus('open')).toBe('open')
  })
})

describe('resolvedAtForStatus', () => {
  const now = new Date('2026-06-01T00:00:00Z')
  it('stamps the resolved time when closed', () => {
    expect(resolvedAtForStatus('closed', now)).toBe(now)
  })
  it('clears it for every non-closed status', () => {
    expect(resolvedAtForStatus('open', now)).toBeNull()
    expect(resolvedAtForStatus('pending', now)).toBeNull()
  })
})

describe('shouldRequeueOnAgentOffline', () => {
  it('re-queues an open conversation the agent never answered', () => {
    expect(shouldRequeueOnAgentOffline('open', false)).toBe(true)
  })

  it('leaves a conversation the agent has already replied to', () => {
    // The agent owns an engaged thread; it stays assigned even when they step away.
    expect(shouldRequeueOnAgentOffline('open', true)).toBe(false)
  })

  it('never re-queues a closed or pending conversation', () => {
    expect(shouldRequeueOnAgentOffline('closed', false)).toBe(false)
    expect(shouldRequeueOnAgentOffline('pending', false)).toBe(false)
  })
})

describe('CONVERSATION_END_REASONS', () => {
  it('is the settled taxonomy in order', () => {
    expect(CONVERSATION_END_REASONS).toEqual([
      'resolved',
      'tracked_as_feedback',
      'duplicate',
      'no_response',
      'spam',
      'other',
    ])
  })
})

describe('resolvedConversationRate', () => {
  it('counts resolved + tracked_as_feedback as resolved', () => {
    // 2 resolved of 4 in the denominator → 0.5.
    expect(
      resolvedConversationRate(['resolved', 'tracked_as_feedback', 'duplicate', 'no_response'])
    ).toBe(0.5)
  })

  it('excludes spam from the denominator entirely', () => {
    // Spam is dropped; the lone 'resolved' is 1/1.
    expect(resolvedConversationRate(['resolved', 'spam', 'spam'])).toBe(1)
  })

  it('counts a null (no recorded reason) ending toward the denominator but not resolved', () => {
    // 1 resolved of 2 ended (the null still counts as ended) → 0.5.
    expect(resolvedConversationRate(['resolved', null])).toBe(0.5)
  })

  it('returns 0 for an empty batch (or one of only spam)', () => {
    expect(resolvedConversationRate([])).toBe(0)
    expect(resolvedConversationRate(['spam'])).toBe(0)
  })
})
