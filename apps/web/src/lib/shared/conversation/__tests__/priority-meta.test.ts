import { describe, it, expect } from 'vitest'
import { priorityMeta, PRIORITY_OPTIONS, PRIORITY_RANK } from '../priority-meta'
import type { ConversationPriority } from '../types'

describe('priorityMeta', () => {
  it('maps each priority to a label and a color', () => {
    expect(priorityMeta('urgent')).toMatchObject({ value: 'urgent', label: 'Urgent' })
    expect(priorityMeta('none')).toMatchObject({ value: 'none', label: 'None' })
    for (const p of ['none', 'low', 'medium', 'high', 'urgent'] as ConversationPriority[]) {
      expect(priorityMeta(p).color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('falls back to "none" for an unknown value', () => {
    expect(priorityMeta('bogus' as ConversationPriority)).toMatchObject({ value: 'none' })
  })
})

describe('PRIORITY_OPTIONS', () => {
  it('covers all five priorities, ordered most-urgent first', () => {
    expect(PRIORITY_OPTIONS.map((p) => p.value)).toEqual([
      'urgent',
      'high',
      'medium',
      'low',
      'none',
    ])
  })
})

describe('PRIORITY_RANK', () => {
  it("ranks urgent highest and none lowest, matching every keyset-sort site's prior local copy", () => {
    expect(PRIORITY_RANK).toEqual({ urgent: 5, high: 4, medium: 3, low: 2, none: 1 })
  })
})
