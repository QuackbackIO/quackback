/**
 * Regression guard: createComment must derive is_team_member from author.role.
 * The import handler's override flips this when authorPrincipalId is given.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostCommentId, PostId, PrincipalId, SegmentId, StatusId } from '@quackback/ids'
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
            id: 'comment_new' as unknown as PostCommentId,
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
              deletedAt: null,
              access: {
                view: 'anonymous',
                vote: 'anonymous',
                comment: 'anonymous',
                submit: 'anonymous',
                segments: { view: [], vote: [], comment: [], submit: [] },
                moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
              },
            },
          }),
        },
        postComments: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
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
    postComments: { __name: 'comments', id: 'id', postId: 'postId', parentId: 'parentId' },
    posts: { __name: 'posts', id: 'id', commentCount: 'comment_count' },
    boards: { id: 'id' },
    postStatuses: { id: 'id' },
    postActivity: {},
    postCommentReactions: {},
    postCommentEditHistory: {},
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
vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

// canCreateComment now consults the workspace requireApproval default as
// the fallback for board-level `inherit` rules. Stub a 'none' default so
// `moderation.comments='inherit'` resolves to off (no approval needed).
vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn().mockResolvedValue({
    moderationDefault: { requireApproval: 'none' },
  }),
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

// Helper: stub the post fixture so `board.access.moderation.comments` matches
// the test's intent. `approvalComments=true` maps to the explicit `'on'`
// override, false to `'inherit'` (workspace defaults to 'none' in the mock,
// so inherit resolves to 'off' — no approval required).
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
      deletedAt: null,
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'anonymous',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: {
          anonPosts: 'inherit',
          signedPosts: 'inherit',
          comments: approvalComments ? 'on' : 'inherit',
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal fixture
  } as any)
}

describe('createComment — board.access.moderation.comments holds for review', () => {
  beforeEach(() => {
    insertedComments.length = 0
    vi.clearAllMocks()
  })

  it("inserts moderationState=pending when moderation.comments='on' and actor is non-team", async () => {
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

  it("inserts moderationState=published when moderation.comments='inherit' and workspace='none'", async () => {
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

  it("team comments are NEVER held even when moderation.comments='on'", async () => {
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

describe('createComment — records a status.changed activity for the audit log', () => {
  beforeEach(() => {
    insertedComments.length = 0
    vi.clearAllMocks()
  })

  it('records status.changed (with toSlug) when a team member changes status via a comment', async () => {
    const { db } = await import('@/lib/server/db')
    // Promise.all fetches new status first, then the post's current status.
    vi.mocked(db.query.postStatuses.findFirst)
      .mockResolvedValueOnce({
        id: 'status_closed',
        name: 'Closed',
        slug: 'closed',
        color: '#111',
        category: 'closed',
        position: 5,
        showOnRoadmap: false,
        isDefault: false,
        createdAt: new Date(),
        deletedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'status_open',
        name: 'Open',
        slug: 'open',
        color: '#888',
        category: 'active',
        position: 0,
        showOnRoadmap: true,
        isDefault: true,
        createdAt: new Date(),
        deletedAt: null,
      })

    const { createActivity } = await import('@/lib/server/domains/activity/activity.service')
    const { createComment } = await import('../comment.service')
    await createComment(
      {
        postId: 'post_p' as unknown as PostId,
        content: 'Closing this out',
        statusId: 'status_closed' as unknown as StatusId,
      },
      { principalId: 'principal_admin' as unknown as PrincipalId, role: 'admin' },
      teamActor,
      { skipDispatch: true }
    )

    expect(vi.mocked(createActivity)).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: 'post_p',
        principalId: 'principal_admin',
        type: 'status.changed',
        metadata: expect.objectContaining({
          fromName: 'Open',
          toName: 'Closed',
          toSlug: 'closed',
        }),
      })
    )
  })

  it('does NOT record a status.changed activity for an ordinary comment', async () => {
    const { createActivity } = await import('@/lib/server/domains/activity/activity.service')
    const { createComment } = await import('../comment.service')
    await createComment(
      { postId: 'post_p' as unknown as PostId, content: 'Just a comment' },
      { principalId: 'principal_admin' as unknown as PrincipalId, role: 'admin' },
      teamActor,
      { skipDispatch: true }
    )
    expect(vi.mocked(createActivity)).not.toHaveBeenCalled()
  })
})

describe('createComment — soft-deleted board is rejected as POST_NOT_FOUND', () => {
  beforeEach(() => {
    insertedComments.length = 0
    vi.clearAllMocks()
  })

  it('rejects when the parent post belongs to a soft-deleted board', async () => {
    // The relational query loads `post.board` eagerly; the in-JS guard rejects
    // when board.deletedAt !== null. From a caller's perspective this is
    // surfaced as POST_NOT_FOUND (we don't leak board state).
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
        deletedAt: new Date(),
        access: {
          view: 'anonymous',
          vote: 'anonymous',
          comment: 'anonymous',
          submit: 'anonymous',
          segments: { view: [], vote: [], comment: [], submit: [] },
          moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal fixture
    } as any)

    const { createComment } = await import('../comment.service')
    await expect(
      createComment(
        { postId: 'post_p' as unknown as PostId, content: 'Hi' },
        { principalId: 'principal_uv' as unknown as PrincipalId, role: 'user' },
        portalActor,
        { skipDispatch: true }
      )
    ).rejects.toThrow(/POST_NOT_FOUND|not found/i)

    // And no comment is inserted.
    expect(insertedComments).toHaveLength(0)
  })
})
