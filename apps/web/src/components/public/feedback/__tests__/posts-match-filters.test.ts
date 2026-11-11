import { describe, expect, it } from 'vitest'
import { postsMatchFilters } from '@/components/public/feedback/feedback-container'
import { postsFetchedFor } from '@/components/public/feedback/portal-data-params'

describe('postsMatchFilters', () => {
  it('seeds the feed when the filters are still the ones the posts were fetched for', () => {
    expect(postsMatchFilters({}, { sort: 'trending' })).toBe(true)
    expect(
      postsMatchFilters({ board: 'ideas', sort: 'top' }, { board: 'ideas', sort: 'top' })
    ).toBe(true)
    expect(postsMatchFilters({ segmentIds: [] }, {})).toBe(true)
  })

  it('does not seed the feed once the visitor changed a filter while the posts loaded', () => {
    expect(postsMatchFilters({}, { sort: 'top' })).toBe(false)
    expect(postsMatchFilters({ board: 'ideas' }, {})).toBe(false)
    expect(postsMatchFilters({ view: 'mine' }, {})).toBe(false)
    expect(postsMatchFilters({}, { search: 'csv' })).toBe(false)
    expect(postsMatchFilters({ owner: 'unassigned' }, {})).toBe(false)
    expect(postsMatchFilters({ segmentIds: ['seg_a'] }, { segmentIds: ['seg_b'] })).toBe(false)
  })

  it('does not seed a narrowed feed from either side', () => {
    expect(postsMatchFilters({ status: ['open'] }, {})).toBe(false)
    expect(postsMatchFilters({}, { tagIds: ['tag_a'] })).toBe(false)
    expect(postsMatchFilters({ minVotes: 5 }, { minVotes: 5 })).toBe(false)
  })

  it('seeds a feed whose default sort is not trending from the posts drawn with the page', () => {
    // The page's posts were fetched with the feed's default sort, and the feed
    // asks for the same one: it must not fetch them (and their counts) again.
    expect(postsMatchFilters(postsFetchedFor({}, 'top'), { sort: 'top' })).toBe(true)
    expect(postsMatchFilters(postsFetchedFor({}, 'new'), { sort: 'new' })).toBe(true)
    expect(postsMatchFilters(postsFetchedFor({ sort: 'trending' }, 'top'), { sort: 'top' })).toBe(
      false
    )
  })
})
