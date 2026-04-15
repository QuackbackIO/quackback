import { describe, it, expect } from 'vitest'
import {
  MAX_CATEGORY_DEPTH,
  collectDescendantIds,
  collectDescendantIdsIncludingSelf,
  getCategoryDepth,
  getSubtreeMaxDepth,
  buildAncestorChain,
} from '../category-tree'

type TestCat = { id: string; parentId: string | null }

/**
 * Fixture tree:
 *   a (top)
 *   ├── b
 *   │   └── d
 *   └── c
 *   e (top, sibling of a)
 */
const flat: TestCat[] = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'a' },
  { id: 'd', parentId: 'b' },
  { id: 'e', parentId: null },
]

describe('MAX_CATEGORY_DEPTH', () => {
  it('is 3', () => {
    expect(MAX_CATEGORY_DEPTH).toBe(3)
  })
})

describe('collectDescendantIds', () => {
  it('returns an empty set for a leaf', () => {
    expect(collectDescendantIds(flat, 'd')).toEqual(new Set())
  })
  it('returns direct children and grandchildren', () => {
    expect(collectDescendantIds(flat, 'a')).toEqual(new Set(['b', 'c', 'd']))
  })
  it('returns only direct child when there is one level', () => {
    expect(collectDescendantIds(flat, 'b')).toEqual(new Set(['d']))
  })
  it('returns an empty set when the id does not exist', () => {
    expect(collectDescendantIds(flat, 'zzz')).toEqual(new Set())
  })
})

describe('collectDescendantIdsIncludingSelf', () => {
  it('includes the root id plus all descendants', () => {
    expect(collectDescendantIdsIncludingSelf(flat, 'a')).toEqual(new Set(['a', 'b', 'c', 'd']))
  })
  it('returns just the id for a leaf', () => {
    expect(collectDescendantIdsIncludingSelf(flat, 'd')).toEqual(new Set(['d']))
  })
  it('returns an empty set when the id does not exist', () => {
    expect(collectDescendantIdsIncludingSelf(flat, 'zzz')).toEqual(new Set())
  })
})

describe('getCategoryDepth', () => {
  it('returns 0 for top-level categories', () => {
    expect(getCategoryDepth(flat, 'a')).toBe(0)
    expect(getCategoryDepth(flat, 'e')).toBe(0)
  })
  it('returns 1 for direct children of top-level', () => {
    expect(getCategoryDepth(flat, 'b')).toBe(1)
    expect(getCategoryDepth(flat, 'c')).toBe(1)
  })
  it('returns 2 for grandchildren', () => {
    expect(getCategoryDepth(flat, 'd')).toBe(2)
  })
  it('returns 0 for unknown id (treated as new top-level)', () => {
    expect(getCategoryDepth(flat, 'zzz')).toBe(0)
  })
})

describe('getSubtreeMaxDepth', () => {
  it('returns 0 for a leaf', () => {
    expect(getSubtreeMaxDepth(flat, 'd')).toBe(0)
    expect(getSubtreeMaxDepth(flat, 'c')).toBe(0)
    expect(getSubtreeMaxDepth(flat, 'e')).toBe(0)
  })
  it('returns 1 for a category with one level of children', () => {
    expect(getSubtreeMaxDepth(flat, 'b')).toBe(1)
  })
  it('returns 2 for a category with two levels of children', () => {
    expect(getSubtreeMaxDepth(flat, 'a')).toBe(2)
  })
  it('returns 0 when the id does not exist', () => {
    expect(getSubtreeMaxDepth(flat, 'zzz')).toBe(0)
  })
})

describe('buildAncestorChain', () => {
  it('returns only the category itself for a top-level node', () => {
    expect(buildAncestorChain(flat, 'a').map((c) => c.id)).toEqual(['a'])
  })
  it('walks up to the root for a leaf', () => {
    expect(buildAncestorChain(flat, 'd').map((c) => c.id)).toEqual(['a', 'b', 'd'])
  })
  it('returns an empty array when the id does not exist', () => {
    expect(buildAncestorChain(flat, 'zzz')).toEqual([])
  })
  it('bails out of a cycle rather than looping forever', () => {
    // Corrupted fixture where a -> b -> a (would never happen via the service,
    // but the helper must not hang if the DB somehow contains a cycle)
    const cyclic: TestCat[] = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]
    expect(() => buildAncestorChain(cyclic, 'a')).not.toThrow()
    const chain = buildAncestorChain(cyclic, 'a')
    // Should terminate without repeating
    expect(chain.length).toBeLessThanOrEqual(2)
  })
})
