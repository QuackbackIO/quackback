import { describe, it, expect } from 'vitest'
import {
  applyVisitorReopenStatus,
  applyAgentReopenStatus,
  shouldWakeSnoozedOnTriage,
  resolvedAtForStatus,
  shouldRequeueOnAgentOffline,
  unreadWatermarkFromAnchor,
  resolvedConversationRate,
} from '../conversation.lifecycle'
import type { PrincipalId } from '@quackback/ids'
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
  it('an ordinary visitor message always surfaces the thread (returns open) from any prior status', () => {
    expect(applyVisitorReopenStatus('open', false)).toBe('open')
    expect(applyVisitorReopenStatus('snoozed', false)).toBe('open')
    expect(applyVisitorReopenStatus('closed', false)).toBe('open')
  })

  it('a matched blockReply on an open/snoozed conversation still surfaces it (no carve-out to apply)', () => {
    expect(applyVisitorReopenStatus('open', true)).toBe('open')
    expect(applyVisitorReopenStatus('snoozed', true)).toBe('open')
  })

  it('SF3: a matched blockReply on an ALREADY-closed conversation leaves it closed (post-close CSAT/button flow)', () => {
    expect(applyVisitorReopenStatus('closed', true)).toBe('closed')
  })
})

describe('applyAgentReopenStatus', () => {
  it('reopens a closed thread but preserves snoozed', () => {
    expect(applyAgentReopenStatus('closed')).toBe('open')
    // An agent reply is "send and stay snoozed" — only a customer or the timer wakes it.
    expect(applyAgentReopenStatus('snoozed')).toBe('snoozed')
    expect(applyAgentReopenStatus('open')).toBe('open')
  })
})

describe('shouldWakeSnoozedOnTriage', () => {
  const assignee = 'principal_assignee' as PrincipalId
  const other = 'principal_other' as PrincipalId

  it('wakes a snoozed thread when a NON-assignee teammate triages it', () => {
    expect(shouldWakeSnoozedOnTriage('snoozed', other, assignee)).toBe(true)
  })

  it('leaves it snoozed when the assignee triages their own thread', () => {
    expect(shouldWakeSnoozedOnTriage('snoozed', assignee, assignee)).toBe(false)
  })

  it('treats any teammate as a non-assignee on an unassigned snoozed thread', () => {
    expect(shouldWakeSnoozedOnTriage('snoozed', other, null)).toBe(true)
  })

  it('never wakes a non-snoozed thread', () => {
    expect(shouldWakeSnoozedOnTriage('open', other, assignee)).toBe(false)
    expect(shouldWakeSnoozedOnTriage('closed', other, assignee)).toBe(false)
  })
})

describe('resolvedAtForStatus', () => {
  const now = new Date('2026-06-01T00:00:00Z')
  it('stamps the resolved time when closed', () => {
    expect(resolvedAtForStatus('closed', now)).toBe(now)
  })
  it('clears it for every non-closed status', () => {
    expect(resolvedAtForStatus('open', now)).toBeNull()
    expect(resolvedAtForStatus('snoozed', now)).toBeNull()
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

  it('never re-queues a closed or snoozed conversation', () => {
    expect(shouldRequeueOnAgentOffline('closed', false)).toBe(false)
    expect(shouldRequeueOnAgentOffline('snoozed', false)).toBe(false)
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
