import { describe, expect, it } from 'vitest'
import {
  conversationTitle,
  describeOverviewActivity,
  formatCompactAge,
  mixAttention,
  ownerInitials,
  publishStatusLabel,
  sortAttention,
  supportAttentionReason,
  type OverviewAttentionItem,
} from '../admin-overview'

describe('supportAttentionReason', () => {
  it('uses the conversation priority label for high and urgent', () => {
    expect(supportAttentionReason({ priority: 'urgent', assigned: true })).toEqual({
      reason: 'Urgent',
      tone: 'urgent',
    })
    expect(supportAttentionReason({ priority: 'high', assigned: false })).toEqual({
      reason: 'High',
      tone: 'urgent',
    })
  })

  it('uses Unassigned when nobody is assigned', () => {
    expect(supportAttentionReason({ priority: 'none', assigned: false })).toEqual({
      reason: 'Unassigned',
      tone: 'neutral',
    })
  })

  it('uses Waiting on reply for assigned waiting conversations', () => {
    expect(supportAttentionReason({ priority: 'medium', assigned: true })).toEqual({
      reason: 'Waiting on reply',
      tone: 'neutral',
    })
  })
})

describe('conversationTitle', () => {
  it('prefers subject, then preview, then Conversation', () => {
    expect(conversationTitle('Sign-in issue', 'hello')).toBe('Sign-in issue')
    expect(conversationTitle('  ', 'Can you help?')).toBe('Can you help?')
    expect(conversationTitle(null, null)).toBe('Conversation')
  })
})

describe('describeOverviewActivity', () => {
  it('uses post_activity status.changed metadata.toName', () => {
    expect(
      describeOverviewActivity({
        source: 'post',
        type: 'status.changed',
        actorName: 'Maya Chen',
        toName: 'Complete',
      })
    ).toBe('Maya Chen moved feedback to Complete')
  })

  it('uses changelog publishedAt-derived status', () => {
    expect(
      describeOverviewActivity({
        source: 'changelog',
        status: 'scheduled',
        actorName: 'James',
      })
    ).toBe('James scheduled a changelog')
  })

  it('does not invent a teammate name when the actor is missing', () => {
    expect(
      describeOverviewActivity({
        source: 'article',
        published: true,
        actorName: null,
      })
    ).toBe('A teammate published an article')
  })
})

describe('sortAttention', () => {
  it('keeps support ahead of feedback and publishing', () => {
    const items = [
      { id: 'p', kind: 'publishing' },
      { id: 'f', kind: 'feedback' },
      { id: 's', kind: 'support' },
    ] as OverviewAttentionItem[]
    expect(sortAttention(items).map((item) => item.id)).toEqual(['s', 'f', 'p'])
  })
})

describe('mixAttention', () => {
  it('round-robins kinds so support cannot fill the whole queue', () => {
    const support = [
      { id: 's1', kind: 'support' },
      { id: 's2', kind: 'support' },
      { id: 's3', kind: 'support' },
    ] as OverviewAttentionItem[]
    const feedback = [{ id: 'f1', kind: 'feedback' }] as OverviewAttentionItem[]
    const publishing = [{ id: 'p1', kind: 'publishing' }] as OverviewAttentionItem[]
    expect(mixAttention([support, feedback, publishing], 4).map((item) => item.id)).toEqual([
      's1',
      'f1',
      'p1',
      's2',
    ])
  })
})

describe('formatCompactAge', () => {
  it('formats minutes and hours', () => {
    const now = Date.parse('2026-09-14T12:00:00Z')
    expect(formatCompactAge('2026-09-14T11:46:00Z', now)).toBe('14m')
    expect(formatCompactAge('2026-09-14T09:30:00Z', now)).toBe('2h 30m')
  })
})

describe('ownerInitials', () => {
  it('returns null when there is no owner name', () => {
    expect(ownerInitials(null)).toBeNull()
    expect(ownerInitials('')).toBeNull()
  })

  it('uses getInitials for a real name', () => {
    expect(ownerInitials('James Doe')).toBe('JD')
  })
})

describe('publishStatusLabel', () => {
  it('matches changelog/article publishedAt states', () => {
    expect(publishStatusLabel('draft')).toBe('Draft')
    expect(publishStatusLabel('scheduled')).toBe('Scheduled')
    expect(publishStatusLabel('published')).toBe('Published')
  })
})
