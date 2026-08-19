import { describe, it, expect } from 'vitest'
import { buildConversationVolume } from '../conversation-volume'

describe('buildConversationVolume', () => {
  it('buckets rows per UTC day and channel, ascending by date', () => {
    const v = buildConversationVolume(
      [
        { createdAt: '2026-07-02T10:00:00Z', source: 'widget' },
        { createdAt: '2026-07-02T23:30:00Z', source: 'widget' },
        { createdAt: '2026-07-01T08:00:00Z', source: 'email' },
        { createdAt: '2026-07-03T12:00:00Z', source: 'ticket_form' },
      ],
      '2026-07-01',
      '2026-07-03'
    )
    expect(v.days).toEqual([
      { date: '2026-07-01', widget: 0, email: 1, ticket_form: 0 },
      { date: '2026-07-02', widget: 2, email: 0, ticket_form: 0 },
      { date: '2026-07-03', widget: 0, email: 0, ticket_form: 1 },
    ])
    expect(v.total).toBe(4)
  })

  it('orders channels by period volume desc so the stack reads largest-first', () => {
    const v = buildConversationVolume(
      [
        { createdAt: '2026-07-01T10:00:00Z', source: 'email' },
        { createdAt: '2026-07-01T11:00:00Z', source: 'widget' },
        { createdAt: '2026-07-01T12:00:00Z', source: 'widget' },
        { createdAt: '2026-07-01T13:00:00Z', source: 'widget' },
      ],
      '2026-07-01',
      '2026-07-01'
    )
    expect(v.channels).toEqual(['widget', 'email'])
  })

  it('zero-fills every day in the range, including days with no conversations', () => {
    const v = buildConversationVolume(
      [{ createdAt: '2026-07-03T09:00:00Z', source: 'widget' }],
      '2026-07-01',
      '2026-07-04'
    )
    expect(v.days.map((d) => d.date)).toEqual([
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
    ])
    expect(v.days[0]).toEqual({ date: '2026-07-01', widget: 0 })
  })

  it('returns an empty channel list when the period has no conversations', () => {
    const v = buildConversationVolume([], '2026-07-01', '2026-07-03')
    expect(v.channels).toEqual([])
    expect(v.total).toBe(0)
    expect(v.days).toHaveLength(3)
    expect(v.days[0]).toEqual({ date: '2026-07-01' })
  })

  it('accepts Date rows and ignores rows outside the requested range', () => {
    const v = buildConversationVolume(
      [
        { createdAt: new Date('2026-07-02T10:00:00Z'), source: 'widget' },
        { createdAt: new Date('2026-06-30T10:00:00Z'), source: 'widget' },
      ],
      '2026-07-01',
      '2026-07-02'
    )
    expect(v.total).toBe(1)
    expect(v.days[1]).toEqual({ date: '2026-07-02', widget: 1 })
  })
})
