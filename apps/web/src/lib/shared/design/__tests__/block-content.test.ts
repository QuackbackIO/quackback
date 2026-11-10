/**
 * What Home's data blocks show from the workspace's data: which columns,
 * which topics in which order, whether a status page has anything to say,
 * and what a block does with nothing to show.
 */
import { describe, expect, it } from 'vitest'
import { newBlock, type HomeBlock } from '@/lib/shared/design/home'
import {
  chosenTopics,
  roadmapColumns,
  shows,
  statusHasComponents,
  whenEmptyOf,
} from '@/lib/shared/design/block-content'

const block = <T extends HomeBlock['type']>(type: T, extra: Record<string, unknown> = {}) =>
  ({ ...newBlock(type), ...extra }) as Extract<HomeBlock, { type: T }>

describe('whenEmptyOf', () => {
  it('keeps what each block always did: Top posts says so, the rest hide', () => {
    expect(whenEmptyOf(block('ideas'))).toBe('message')
    for (const type of ['roadmap', 'updates', 'help_topics', 'status'] as const)
      expect(whenEmptyOf(block(type))).toBe('hide')
  })

  it('follows the block once it says', () => {
    expect(whenEmptyOf(block('ideas', { whenEmpty: 'hide' }))).toBe('hide')
    expect(whenEmptyOf(block('updates', { whenEmpty: 'message' }))).toBe('message')
  })
})

describe('shows', () => {
  it('reads each item part with its usual setting when absent', () => {
    const ideas = block('ideas')
    expect([
      shows(ideas, 'showVotes'),
      shows(ideas, 'showStatus'),
      shows(ideas, 'showComments'),
    ]).toEqual([true, true, false])
    const updates = block('updates')
    expect([shows(updates, 'showDate'), shows(updates, 'showSummary')]).toEqual([true, false])
    expect(shows(block('roadmap'), 'showVotes')).toBe(false)
    expect(shows(block('help_topics'), 'showCounts')).toBe(true)
    expect(shows(block('status'), 'showIncidents')).toBe(true)
  })

  it('follows a setting once set', () => {
    expect(shows(block('ideas', { showVotes: false }), 'showVotes')).toBe(false)
    expect(shows(block('updates', { showSummary: true }), 'showSummary')).toBe(true)
  })
})

describe('roadmapColumns', () => {
  const roadmap = {
    id: 'roadmap_1',
    columns: [
      { id: 'c1', statusId: 'post_status_a' },
      { id: 'c2', statusId: null },
      { id: 'c3', statusId: 'post_status_b' },
      { id: 'c4', statusId: 'post_status_c' },
    ],
  }

  it('is every column with a status when none is picked', () => {
    expect(roadmapColumns(roadmap, block('roadmap')).map((c) => c.id)).toEqual(['c1', 'c3', 'c4'])
    expect(roadmapColumns(roadmap, block('roadmap', { statusIds: [] })).map((c) => c.id)).toEqual([
      'c1',
      'c3',
      'c4',
    ])
  })

  it('is the picked columns, in the roadmap’s order', () => {
    const picked = block('roadmap', { statusIds: ['post_status_c', 'post_status_a'] })
    expect(roadmapColumns(roadmap, picked).map((c) => c.id)).toEqual(['c1', 'c4'])
  })

  it('is none when the picked columns are gone', () => {
    expect(roadmapColumns(roadmap, block('roadmap', { statusIds: ['post_status_z'] }))).toEqual([])
    expect(roadmapColumns(undefined, block('roadmap'))).toEqual([])
  })
})

describe('chosenTopics', () => {
  const categories = [
    { id: 'kb_category_a', parentId: null },
    { id: 'kb_category_sub', parentId: 'kb_category_a' },
    { id: 'kb_category_b', parentId: null },
    { id: 'kb_category_c', parentId: null },
  ]

  it('is the first top-level topics when none is picked', () => {
    expect(chosenTopics(categories, []).map((c) => c.id)).toEqual([
      'kb_category_a',
      'kb_category_b',
      'kb_category_c',
    ])
  })

  it('is the picked top-level topics, in the order picked', () => {
    expect(
      chosenTopics(categories, ['kb_category_c', 'kb_category_sub', 'kb_category_a']).map(
        (c) => c.id
      )
    ).toEqual(['kb_category_c', 'kb_category_a'])
  })

  it('is none when only sub-topics are picked', () => {
    expect(chosenTopics(categories, ['kb_category_sub'])).toEqual([])
  })

  it('holds at most eight', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `kb_category_${i}`, parentId: null }))
    expect(chosenTopics(many, [])).toHaveLength(8)
  })
})

describe('statusHasComponents', () => {
  it('is whether the status page shows any component, grouped or not', () => {
    expect(statusHasComponents({ groups: [], ungroupedComponents: [] })).toBe(false)
    expect(statusHasComponents({ groups: [{ components: [] }], ungroupedComponents: [] })).toBe(
      false
    )
    expect(statusHasComponents({ groups: [{ components: [{}] }], ungroupedComponents: [] })).toBe(
      true
    )
    expect(statusHasComponents({ groups: [], ungroupedComponents: [{}] })).toBe(true)
  })
})
