import { describe, expect, it } from 'vitest'
import { matchQuery } from '@tanstack/react-query'
import { publicPostFacetsKeys, publicPostsKeys } from '../use-portal-posts-query'

describe('publicPostFacetsKeys', () => {
  it('stays out of reach of the feed-page updaters', () => {
    const facetsQuery = { queryKey: publicPostFacetsKeys.counts({}, null), queryHash: 'x' }
    // The vote, edit and delete mutations call setQueriesData on lists().
    expect(matchQuery({ queryKey: publicPostsKeys.lists() }, facetsQuery as never)).toBe(false)
  })

  it('keeps counts apart per viewer', () => {
    expect(publicPostFacetsKeys.counts({}, 'user_a')).not.toEqual(
      publicPostFacetsKeys.counts({}, null)
    )
  })
})
