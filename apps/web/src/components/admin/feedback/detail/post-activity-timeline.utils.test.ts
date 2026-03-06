import { describe, expect, it } from 'vitest'
import { getLatestMergeStateByDuplicateId } from './post-activity-timeline.utils'

describe('getLatestMergeStateByDuplicateId', () => {
  it('treats the latest merge event as the current state', () => {
    const mergeState = getLatestMergeStateByDuplicateId([
      {
        type: 'post.merged_in',
        metadata: { duplicatePostId: 'post_duplicate' },
      },
      {
        type: 'post.unmerged',
        metadata: { otherPostId: 'post_duplicate' },
      },
    ])

    expect(mergeState.get('post_duplicate')).toBe(false)
  })

  it('marks duplicates as unmerged when the latest event is an unmerge', () => {
    const mergeState = getLatestMergeStateByDuplicateId([
      {
        type: 'post.unmerged',
        metadata: { otherPostId: 'post_duplicate' },
      },
      {
        type: 'post.merged_in',
        metadata: { duplicatePostId: 'post_duplicate' },
      },
    ])

    expect(mergeState.get('post_duplicate')).toBe(true)
  })
})
