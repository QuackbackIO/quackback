/**
 * Regression guard: createComment must derive is_team_member from author.role.
 * The import handler's override flips this when authorPrincipalId is given.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommentId, PostId, PrincipalId, SegmentId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'

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
  dispatchPostStatusChanged: vi.fn(),
  buildEventActor: vi.fn(() => ({})),
}))
vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: vi.fn(),
}))

// A minimal team actor sufficient for all three tests (public board, published post)
const teamActor: Actor = {
  principalId: 'principal_admin' as unknown as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set<SegmentId>(),
}

const portalActor: Actor = {
  principalId: 'principal_uv' as unknown as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set<SegmentId>(),
}

describe('createComment isTeamMember derivation', () => {
  beforeEach(() => {
    insertedComments.length = 0
  })

  it('marks comment as team-member when author.role is admin', async () => {
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_admin' as unknown as PrincipalId, role: 'admin' },
      teamActor,
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ isTeamMember: true })
  })

  it('marks comment as team-member when author.role is member', async () => {
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_member' as unknown as PrincipalId, role: 'member' },
      { ...teamActor, role: 'member', principalId: 'principal_member' as unknown as PrincipalId },
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ isTeamMember: true })
  })

  it('does NOT mark comment as team-member when author.role is user', async () => {
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_uv' as unknown as PrincipalId, role: 'user' },
      portalActor,
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ isTeamMember: false })
  })
})

// Helper: stub the post fixture so `board.access.approval.comments` matches
// the test's intent. The default mock returns approval.comments=false.
async function mockPostWithApproval(approvalComments: boolean) {
  const { db } = await import('@/lib/server/db')
  vi.mocked(db.query.posts.findFirst).mockResolvedValueOnce({
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
        approval: { posts: false, comments: approvalComments },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal fixture
  } as any)
}

describe('createComment — board.access.approval.comments holds for review', () => {
  beforeEach(() => {
    insertedComments.length = 0
    vi.clearAllMocks()
  })

  it('inserts moderationState=pending when approval.comments=true and actor is non-team', async () => {
    await mockPostWithApproval(true)
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_uv' as unknown as PrincipalId, role: 'user' },
      portalActor,
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ moderationState: 'pending' })
  })

  it('inserts moderationState=published when approval.comments=false', async () => {
    await mockPostWithApproval(false)
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_uv' as unknown as PrincipalId, role: 'user' },
      portalActor,
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ moderationState: 'published' })
  })

  it('team comments are NEVER held even when approval.comments=true', async () => {
    await mockPostWithApproval(true)
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_admin' as unknown as PrincipalId, role: 'admin' },
      teamActor,
      { skipDispatch: true }
    )
    expect(insertedComments[0]).toMatchObject({ moderationState: 'published' })
  })

  it('emits comment.moderation.held audit when a comment is held', async () => {
    await mockPostWithApproval(true)
    const { recordAuditEvent } = await import('@/lib/server/audit/log')
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_uv' as unknown as PrincipalId, role: 'user' },
      portalActor,
      { skipDispatch: true }
    )
    expect(vi.mocked(recordAuditEvent)).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'comment.moderation.held',
        target: expect.objectContaining({ type: 'comment' }),
        after: expect.objectContaining({ moderationState: 'pending' }),
      })
    )
  })

  it('does NOT emit comment.moderation.held when the comment is published', async () => {
    await mockPostWithApproval(false)
    const { recordAuditEvent } = await import('@/lib/server/audit/log')
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_uv' as unknown as PrincipalId, role: 'user' },
      portalActor,
      { skipDispatch: true }
    )
    expect(vi.mocked(recordAuditEvent)).not.toHaveBeenCalled()
  })

  it('held comments do NOT dispatch comment.created (defer until approval)', async () => {
    await mockPostWithApproval(true)
    const { dispatchCommentCreated } = await import('@/lib/server/events/dispatch')
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_uv' as unknown as PrincipalId, role: 'user' },
      portalActor
      // intentionally no skipDispatch — verify the function itself gates dispatch
    )
    expect(vi.mocked(dispatchCommentCreated)).not.toHaveBeenCalled()
  })

  it('held comments DO subscribe the author to the post (so they hear about approval)', async () => {
    await mockPostWithApproval(true)
    const { subscribeToPost } =
      await import('@/lib/server/domains/subscriptions/subscription.service')
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Hi' },
      { principalId: 'principal_uv' as unknown as PrincipalId, role: 'user' },
      portalActor
    )
    expect(vi.mocked(subscribeToPost)).toHaveBeenCalled()
  })
})
