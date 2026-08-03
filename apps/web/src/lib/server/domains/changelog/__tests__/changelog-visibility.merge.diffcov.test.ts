/**
 * Differential-coverage tests for changelog-visibility.service —
 * mergeChangelogVisibilityConfigs union/most-permissive logic across the
 * category + product dimensions.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/db', () => ({
  db: {},
  eq: vi.fn(),
  settings: {},
  userSegments: {},
  segments: {},
  changelogSegmentVisibility: {},
}))
vi.mock('@/lib/server/logger', () => ({ logger: { child: () => ({ error: vi.fn() }) } }))

import {
  mergeChangelogVisibilityConfigs,
  invalidateChangelogVisibilityCache,
} from '../changelog-visibility.service'

describe('mergeChangelogVisibilityConfigs', () => {
  it('returns no restriction for an empty config list', () => {
    expect(mergeChangelogVisibilityConfigs([])).toEqual({
      allowedCategoryIds: null,
      allowedProductIds: null,
    })
  })
  it('unions allowed ids when every config restricts that dimension', () => {
    const merged = mergeChangelogVisibilityConfigs([
      {
        restrictCategories: true,
        allowedCategoryIds: ['c1'],
        restrictProducts: true,
        allowedProductIds: ['p1'],
      },
      {
        restrictCategories: true,
        allowedCategoryIds: ['c2'],
        restrictProducts: true,
        allowedProductIds: ['p1', 'p2'],
      },
    ] as never)
    expect(new Set(merged.allowedCategoryIds)).toEqual(new Set(['c1', 'c2']))
    expect(new Set(merged.allowedProductIds)).toEqual(new Set(['p1', 'p2']))
  })
  it('falls back to unrestricted when any config does not restrict (and tolerates missing id arrays)', () => {
    const merged = mergeChangelogVisibilityConfigs([
      { restrictCategories: true, restrictProducts: true } as never, // missing id arrays -> ?? []
      { restrictCategories: false, restrictProducts: false } as never, // not restricted -> null
    ])
    expect(merged.allowedCategoryIds).toBeNull()
    expect(merged.allowedProductIds).toBeNull()
  })
  it('exposes a cache invalidator', () => {
    expect(() => invalidateChangelogVisibilityCache()).not.toThrow()
  })
})
