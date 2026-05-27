/**
 * Regression guard: createComment + userEditComment dual-write contentJson
 * alongside the markdown `content` column. Mirrors the posts pattern so the
 * read path (comment-content.tsx) can short-circuit on the precomputed
 * TipTap doc instead of parsing markdown on every render.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentId, PostId, PrincipalId, SegmentId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

const insertedComments: Record<string, unknown>[] = []
const insertedEditHistory: Record<string, unknown>[] = []
const updatedComments: Record<string, unknown>[] = []

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  function chain(label: string) {
    const c: Record<string, unknown> = {}
    c.values = vi.fn((row: Record<string, unknown>) => {
      if (label === 'comments') insertedComments.push(row)
      if (label === 'commentEditHistory') insertedEditHistory.push(row)
      return c
    })
    c.set = vi.fn((row: Record<string, unknown>) => {
      if (label === 'comments') updatedComments.push(row)
      return c
    })
    c.where = vi.fn(() => c)
    c.returning = vi.fn(async () => {
      if (label === 'comments') {
        const last = updatedComments.at(-1) ?? insertedComments.at(-1) ?? {}
        return [
          {
            id: 'comment_existing' as unknown as CommentId,
            postId: 'post_p' as unknown as PostId,
            content: last.content ?? 'Hi',
            contentJson: last.contentJson ?? null,
            parentId: null,
            principalId: 'principal_author' as unknown as PrincipalId,
            isTeamMember: false,
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
    update: vi.fn(() => chain('comments')),
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
            moderationState: 'published',
            principalId: null,
            board: {
              id: 'board_b',
              slug: 'b',
              access: {
                view: 'anonymous',
                comment: 'anonymous',
                submit: 'anonymous',
                segmentIds: [],
                approval: { posts: false, comments: false },
              },
            },
          }),
        },
        comments: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'comment_existing',
            postId: 'post_p',
            content: 'Old content',
            contentJson: null,
            parentId: null,
            principalId: 'principal_author',
            isTeamMember: false,
            isPrivate: false,
            post: { id: 'post_p', title: 'P', board: { id: 'board_b', slug: 'b' } },
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        postStatuses: {
          findFirst: vi.fn().mockResolvedValue({ id: 'status_open', name: 'Open' }),
        },
      },
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
      insert: vi.fn((table: { __name?: string }) => chain(table?.__name ?? 'unknown')),
      update: vi.fn(() => chain('comments')),
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
    commentEditHistory: { __name: 'commentEditHistory' },
  }
})

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: vi.fn(),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchCommentCreated: vi.fn(),
  dispatchCommentUpdated: vi.fn(),
  buildEventActor: vi.fn(() => ({})),
}))

const portalActor: Actor = {
  principalId: 'principal_a' as unknown as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set<SegmentId>(),
}

describe('createComment contentJson dual-write', () => {
  beforeEach(() => {
    insertedComments.length = 0
    insertedEditHistory.length = 0
    updatedComments.length = 0
  })

  it('derives contentJson from markdown when only content is provided', async () => {
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: '**bold** body' },
      { principalId: 'principal_a' as unknown as PrincipalId, role: 'user' },
      portalActor,
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ content: '**bold** body' })
    expect(insertedComments[0].contentJson).toBeDefined()
    expect(insertedComments[0].contentJson).not.toBeNull()
  })

  it('uses supplied contentJson when both content and contentJson are provided', async () => {
    const { createComment } = await import('../comment.service')
    const providedJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'pre-baked from editor', marks: [{ type: 'bold' }] }],
        },
      ],
    }
    await createComment(
      {
        postId: 'post_p' as unknown as PostId,
        content: 'pre-baked from editor',
        contentJson: providedJson,
      },
      { principalId: 'principal_a' as unknown as PrincipalId, role: 'user' },
      portalActor,
      { skipDispatch: true }
    )
    expect(insertedComments[0].contentJson).toEqual(providedJson)
  })
})

describe('userEditComment contentJson dual-write', () => {
  beforeEach(() => {
    insertedComments.length = 0
    insertedEditHistory.length = 0
    updatedComments.length = 0
  })

  it('updates contentJson alongside content and stores previousContentJson in history', async () => {
    const { userEditComment } = await import('../comment.permissions')
    await userEditComment('comment_existing' as unknown as CommentId, '*italic* edited', {
      principalId: 'principal_author' as unknown as PrincipalId,
      role: 'user',
    })
    expect(updatedComments[0]).toMatchObject({ content: '*italic* edited' })
    expect(updatedComments[0].contentJson).toBeDefined()
    expect(updatedComments[0].contentJson).not.toBeNull()
    expect(insertedEditHistory[0]).toMatchObject({ previousContent: 'Old content' })
    expect(insertedEditHistory[0]).toHaveProperty('previousContentJson')
  })
})
