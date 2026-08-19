/**
 * Coverage for bulkChangePostStatuses (feedback inbox bulk status change): the
 * helper fans one toolbar action out over the selection by REUSING the
 * single-post changePostStatusFn, so every post gets the same events and
 * notifications as an individual status change. These tests pin the per-item
 * error isolation and the summary shape the toolbar toasts from.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PostStatusId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  changePostStatusFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/posts', () => ({
  changePostStatusFn: hoisted.changePostStatusFn,
  changePostBoardFn: vi.fn(),
  updatePostFn: vi.fn(),
  setPostOwnerFn: vi.fn(),
  setPostEtaFn: vi.fn(),
  updatePostTagsFn: vi.fn(),
  createPostFn: vi.fn(),
  toggleCommentsLockFn: vi.fn(),
  deletePostFn: vi.fn(),
  restorePostFn: vi.fn(),
  proxyVoteFn: vi.fn(),
  removeVoteFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/public-posts', () => ({
  toggleVoteFn: vi.fn(),
}))

import { bulkChangePostStatuses } from '../posts'

const STATUS = 'post_status_planned' as PostStatusId

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.changePostStatusFn.mockResolvedValue({})
})

describe('bulkChangePostStatuses', () => {
  it('applies the status to every post through the single-post fn', async () => {
    const result = await bulkChangePostStatuses(
      ['post_p1' as PostId, 'post_p2' as PostId, 'post_p3' as PostId],
      STATUS
    )
    expect(result).toEqual({
      succeeded: ['post_p1', 'post_p2', 'post_p3'],
      failed: [],
    })
    expect(hoisted.changePostStatusFn).toHaveBeenCalledTimes(3)
    expect(hoisted.changePostStatusFn).toHaveBeenNthCalledWith(1, {
      data: { id: 'post_p1', statusId: STATUS },
    })
    expect(hoisted.changePostStatusFn).toHaveBeenNthCalledWith(3, {
      data: { id: 'post_p3', statusId: STATUS },
    })
  })

  it('isolates a middle failure and reports it in failed without aborting the batch', async () => {
    hoisted.changePostStatusFn.mockImplementation(async ({ data }: { data: { id: string } }) => {
      if (data.id === 'post_p2') throw new Error('status is archived')
      return {}
    })
    const result = await bulkChangePostStatuses(
      ['post_p1' as PostId, 'post_p2' as PostId, 'post_p3' as PostId],
      STATUS
    )
    expect(result.succeeded).toEqual(['post_p1', 'post_p3'])
    expect(result.failed).toEqual([{ id: 'post_p2', reason: 'status is archived' }])
    expect(hoisted.changePostStatusFn).toHaveBeenCalledTimes(3)
  })

  it('reduces a non-Error throw to a stable reason string', async () => {
    hoisted.changePostStatusFn.mockRejectedValueOnce('nope')
    const result = await bulkChangePostStatuses(['post_p1' as PostId], STATUS)
    expect(result).toEqual({
      succeeded: [],
      failed: [{ id: 'post_p1', reason: 'Unknown error' }],
    })
  })
})
