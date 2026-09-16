import { describe, expect, it } from 'vitest'
import {
  buildOverviewMetrics,
  conversationTitle,
  formatCompactAge,
  mixAttention,
  overviewMetricGridClass,
  ownerInitials,
  publishStatusLabel,
  supportAttentionRank,
  supportAttentionReason,
  viewerFirst,
  type OverviewAttentionItem,
  type OverviewLink,
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

describe('supportAttentionRank', () => {
  it('keeps urgency ahead of the viewer, then unassigned, then the rest of the team', () => {
    const urgent = supportAttentionRank({ priority: 'urgent', assigned: false, mine: false })
    const high = supportAttentionRank({ priority: 'high', assigned: true, mine: false })
    const mine = supportAttentionRank({ priority: 'medium', assigned: true, mine: true })
    const unassigned = supportAttentionRank({ priority: 'medium', assigned: false, mine: false })
    const teammate = supportAttentionRank({ priority: 'medium', assigned: true, mine: false })
    expect([urgent, high, mine, unassigned, teammate]).toEqual([0, 1, 2, 3, 4])
  })
})

describe('viewerFirst', () => {
  it('moves the viewer’s items to the front without reordering the rest', () => {
    const items = [
      { id: 'a', mine: false },
      { id: 'b', mine: true },
      { id: 'c', mine: false },
      { id: 'd', mine: true },
    ]
    expect(viewerFirst(items).map((item) => item.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('conversationTitle', () => {
  it('prefers subject, then preview, then Conversation', () => {
    expect(conversationTitle('Sign-in issue', 'hello')).toBe('Sign-in issue')
    expect(conversationTitle('  ', 'Can you help?')).toBe('Can you help?')
    expect(conversationTitle(null, null)).toBe('Conversation')
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
    const changelogReady = [{ id: 'p1', kind: 'feedback' }] as OverviewAttentionItem[]
    expect(mixAttention([support, feedback, changelogReady], 4).map((item) => item.id)).toEqual([
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
  })
})

const inbox: OverviewLink = { to: '/admin/inbox' }
const feedback: OverviewLink = { to: '/admin/feedback' }
const help: OverviewLink = { to: '/admin/help-center' }

describe('buildOverviewMetrics', () => {
  it('pairs each count with an item and a state', () => {
    const metrics = buildOverviewMetrics({
      support: { waitingCount: 3, waitingLink: inbox },
      feedback: {
        reviewCount: 30,
        completeCount: 6,
        reviewLink: feedback,
        completeLink: feedback,
      },
      help: { draftCount: 0, draftLink: help },
    })

    expect(metrics.map((metric) => [metric.count, metric.label, metric.detail])).toEqual([
      [3, 'conversations', 'waiting for reply'],
      [30, 'feedback posts', 'to review'],
      [6, 'feedback posts', 'with no changelog'],
      [0, 'help center articles', 'in draft'],
    ])
    for (const metric of metrics) {
      expect(metric).not.toHaveProperty('unit')
      expect(metric).not.toHaveProperty('hint')
    }
  })

  it('pluralizes help center articles', () => {
    const [drafts] = buildOverviewMetrics({ help: { draftCount: 1, draftLink: help } })
    expect(drafts).toMatchObject({
      count: 1,
      label: 'help center article',
      detail: 'in draft',
    })
  })

  it('omits sections that are off', () => {
    expect(buildOverviewMetrics({})).toEqual([])
  })
})

describe('overviewMetricGridClass', () => {
  it('does not use three columns on small screens', () => {
    expect(overviewMetricGridClass(1)).toBe('grid-cols-1')
    expect(overviewMetricGridClass(2)).toBe('grid-cols-2')
    expect(overviewMetricGridClass(3)).toBe('grid-cols-1 sm:grid-cols-3')
    expect(overviewMetricGridClass(4)).toBe('grid-cols-2 lg:grid-cols-4')
  })
})
