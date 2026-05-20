/**
 * Regression guard: createComment must derive is_team_member from author.role.
 * The import handler's override flips this when authorPrincipalId is given.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentId, PostId, PrincipalId } from '@quackback/ids'

const insertedComments: Record<string, unknown>[] = []

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  function chain(label: string) {
    const c: Record<string, unknown> = {}
    c.values = vi.fn((row: Record<string, unknown>) => {
      if (label === 'comments') insertedComments.push(row)
      return c
    })
    c.set = vi.fn(() => c)
    c.where = vi.fn(() => c)
    c.returning = vi.fn(async () => {
      if (label === 'comments') {
        const last = insertedComments.at(-1) ?? {}
        return [
          {
            id: 'comment_new' as unknown as CommentId,
            postId: 'post_p' as unknown as PostId,
            content: 'Hi',
            parentId: null,
            principalId: last.principalId,
            isTeamMember: last.isTeamMember,
            isPrivate: false,
            createdAt: new Date(),
            statusChangeFromId: null,
            statusChangeToId: null,
            deletedAt: null,
          },
        ]
      }
      return []
    })
    c.catch = vi.fn().mockReturnValue(Promise.resolve())
    return c
  }

  const tx = {
    insert: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
    update: vi.fn(() => chain('posts')),
  }

  return {
    db: {
      query: {
        posts: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'post_p',
            title: 'P',
            boardId: 'board_b',
            statusId: 'status_open',
            isCommentsLocked: false,
            board: { id: 'board_b', slug: 'b' },
          }),
        },
        comments: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
        postStatuses: {
          findFirst: vi.fn().mockResolvedValue({ id: 'status_open', name: 'Open' }),
        },
      },
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    },
    eq: vi.fn(),
    and: vi.fn(),
    isNull: vi.fn(),
    asc: vi.fn(),
    sql: realSql,
    comments: { __name: 'comments', id: 'id', postId: 'postId', parentId: 'parentId' },
    posts: { __name: 'posts', id: 'id', commentCount: 'comment_count' },
    boards: { id: 'id' },
    postStatuses: { id: 'id' },
    postActivity: {},
    commentReactions: {},
    commentEditHistory: {},
  }
})

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: vi.fn(),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchCommentCreated: vi.fn(),
  buildEventActor: vi.fn(() => ({})),
}))

describe('createComment isTeamMember derivation', () => {
  beforeEach(() => {
    insertedComments.length = 0
  })

  it('marks comment as team-member when author.role is admin', async () => {
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_admin' as unknown as PrincipalId, role: 'admin' },
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ isTeamMember: true })
  })

  it('marks comment as team-member when author.role is member', async () => {
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_member' as unknown as PrincipalId, role: 'member' },
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ isTeamMember: true })
  })

  it('does NOT mark comment as team-member when author.role is user', async () => {
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_uv' as unknown as PrincipalId, role: 'user' },
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ isTeamMember: false })
  })
})
