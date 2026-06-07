import { describe, it, expect } from 'vitest'
import { collectCardRefs, buildCardView } from '../chat.card-view'

const draft = (over = {}) =>
  ({
    type: 'draft_post',
    status: 'proposed',
    boardId: 'board_1',
    title: 'T',
    content: 'C',
    ...over,
  }) as const
const ref = (postId: string) => ({ type: 'post_ref', postId }) as const

describe('collectCardRefs', () => {
  it('collects board ids from draft cards and post ids from refs + published drafts', () => {
    const cards = [draft(), draft({ status: 'published', postId: 'post_9' }), ref('post_5')]
    const { boardIds, postIds } = collectCardRefs(cards as any)
    expect([...boardIds].sort()).toEqual(['board_1'])
    expect([...postIds].sort()).toEqual(['post_5', 'post_9'])
  })
})

describe('buildCardView', () => {
  const boards = new Map([['board_1', { name: 'Feature Requests', slug: 'features' }]])
  const posts = new Map([
    [
      'post_5',
      {
        title: 'Dark mode',
        voteCount: 12,
        statusName: 'Open',
        statusColor: '#22c55e',
        boardSlug: 'features',
        boardName: 'Feature Requests',
      },
    ],
  ])
  it('builds a draft_post view (proposed → no postTitle)', () => {
    expect(buildCardView(draft() as any, boards, posts)).toEqual({
      type: 'draft_post',
      boardName: 'Feature Requests',
      boardSlug: 'features',
    })
  })
  it('builds a draft_post view (published → postTitle from the post map)', () => {
    expect(
      buildCardView(draft({ status: 'published', postId: 'post_5' }) as any, boards, posts)
    ).toEqual({
      type: 'draft_post',
      boardName: 'Feature Requests',
      boardSlug: 'features',
      postTitle: 'Dark mode',
    })
  })
  it('builds a post_ref view from the post map', () => {
    expect(buildCardView(ref('post_5') as any, boards, posts)).toEqual({
      type: 'post_ref',
      title: 'Dark mode',
      voteCount: 12,
      statusName: 'Open',
      statusColor: '#22c55e',
      boardName: 'Feature Requests',
      boardSlug: 'features',
    })
  })
  it('returns null when the referenced id is missing', () => {
    expect(buildCardView(ref('post_x') as any, boards, posts)).toBeNull()
    expect(buildCardView(draft({ boardId: 'board_x' }) as any, boards, posts)).toBeNull()
  })
})
