/**
 * `categoryFilterCondition` — the "give me entries labelled X" predicate.
 *
 * The distinction these tests pin down is the one that is easy to get wrong:
 * "no filter requested" and "filter that matches nothing" are different
 * answers. A blank or absent param must return undefined (caller skips it, so
 * the list is unfiltered), while a name that simply doesn't exist must still
 * produce a condition — otherwise `?labels=typo` would silently return the
 * whole changelog instead of nothing.
 */
import { describe, it, expect, vi } from 'vitest'
import type { ChangelogCategoryId } from '@quackback/ids'

const mockWhere = vi.fn(() => ({ __subquery: true }))
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }))
const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    selectDistinct: () => ({ from: mockFrom }),
  },
}))

import { categoryFilterCondition } from '../changelog-category.service'

const CATEGORY_A = 'changelog_category_01a' as unknown as ChangelogCategoryId

describe('categoryFilterCondition — no filter requested', () => {
  it('returns undefined when neither list is given', () => {
    expect(categoryFilterCondition({})).toBeUndefined()
  })

  it('returns undefined for empty lists', () => {
    expect(categoryFilterCondition({ categories: [], categoryIds: [] })).toBeUndefined()
  })

  it('returns undefined when every name is blank', () => {
    expect(categoryFilterCondition({ categories: ['', '   '] })).toBeUndefined()
  })
})

describe('categoryFilterCondition — filter requested', () => {
  it('builds a condition for names', () => {
    expect(categoryFilterCondition({ categories: ['releases'] })).toBeDefined()
  })

  it('builds a condition for ids', () => {
    expect(categoryFilterCondition({ categoryIds: [CATEGORY_A] })).toBeDefined()
  })

  it('builds a condition for an unknown name rather than falling back to no filter', () => {
    // The whole point: a typo must return nothing, not everything.
    expect(categoryFilterCondition({ categories: ['no-such-label'] })).toBeDefined()
  })

  it('ignores blank entries but keeps the real ones', () => {
    expect(categoryFilterCondition({ categories: ['', 'releases', '  '] })).toBeDefined()
  })
})
