/**
 * Regression guard: createPost must derive the auto-upvote (and the row's
 * principal_id) from author.principalId, so the import handler's override
 * lands on every attributed row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardId, PrincipalId, StatusId } from '@quackback/ids'

const recordAuditEvent = vi.fn()
const rehostExternalImages = vi.fn(async (json: unknown) => json)

const insertedRows: Record<string, unknown[]> = {
  posts: [],
  post_votes: [],
  postTagAssignments: [],
}
const subscribeToPost = vi.fn()
const dispatchPostCreated = vi.fn().mockResolvedValue(undefined)
const syncPostMentions = vi.fn().mockResolvedValue(undefined)

// Access matrix the locked-board re-check sees by default: fully anonymous with
// inherit moderation, so the in-transaction canCreatePost re-check passes and
// moderationState follows the workspace requireApproval mock (same as the
// precheck board).
const LOCKED_ANON_ACCESS = {
  view: 'anonymous',
  vote: 'anonymous',
  comment: 'anonymous',
  submit: 'anonymous',
  segments: { view: [], vote: [], comment: [], submit: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
}

// Holder for what the in-transaction SELECT ... FOR UPDATE on boards returns.
// Default: a single non-deleted row (with access), which is what almost every
// test wants. The TOCTOU test below sets `.value = []` to simulate a concurrent
// soft-delete (the locked SELECT filters isNull(deletedAt) → zero rows).
const txLockedBoardRows: { value: Array<{ deletedAt: Date | null; access?: unknown }> } = {
  value: [{ deletedAt: null, access: LOCKED_ANON_ACCESS }],
}

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  function chain(label: string) {
    const c: Record<string, unknown> = {}
    c.values = vi.fn((row: unknown) => {
      insertedRows[label] = (insertedRows[label] ?? []).concat(row)
      return c
    })
    c.returning = vi.fn(async () => {
      if (label === 'posts') {
        return [
          {
            id: 'post_new' as unknown,
            boardId: 'board_b' as unknown,
            statusId: 'status_open' as unknown,
            title: 'New post',
            content: 'Body',
            principalId: (insertedRows.posts.at(-1) as { principalId: string }).principalId,
            voteCount: 1,
            commentCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]
      }
      return []
    })
    return c
  }

  return {
    db: {
      query: {
        boards: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'board_b',
            slug: 'feedback',
            name: 'Feedback',
            access: {
              view: 'anonymous',
              vote: 'anonymous',
              comment: 'anonymous',
              submit: 'anonymous',
              segments: { view: [], vote: [], comment: [], submit: [] },
              moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
            },
          }),
        },
        postStatuses: {
          findFirst: vi.fn().mockResolvedValue({ id: 'status_open', name: 'Open' }),
        },
      },
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        // Default: SELECT ... FOR UPDATE on the board returns a live (non-deleted)
        // row. Specific tests can override the resolved value via
        // `txLockedBoardRows.value` to simulate concurrent soft-delete (empty array
        // or `deletedAt: <Date>`), exercising the createPost TOCTOU guard.
        const tx = {
          insert: vi.fn((table: { __name?: string }) => {
            const label =
              table === undefined
                ? 'unknown'
                : (table.__name ?? (table as { [k: string]: unknown }).name ?? 'unknown')
            return chain(typeof label === 'string' ? label : 'posts')
          }),
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => ({
                for: vi.fn(async () => txLockedBoardRows.value),
              })),
            })),
          })),
        }
        return fn(tx)
      }),
      select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    },
    boards: { id: 'board_id' },
    posts: { __name: 'posts', id: 'post_id' },
    postStatuses: { id: 'status_id' },
    postTagAssignments: { __name: 'postTagAssignments' },
    postVotes: { __name: 'post_votes' },
    eq: vi.fn(),
    and: vi.fn((...args: unknown[]) => args),
    sql: realSql,
  }
})

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: (...args: unknown[]) => subscribeToPost(...args),
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostCreated: (...args: unknown[]) => dispatchPostCreated(...args),
  buildEventActor: vi.fn(() => ({})),
}))

vi.mock('../sync-post-mentions', () => ({
  syncPostMentions: (...args: unknown[]) => syncPostMentions(...args),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

vi.mock('@/lib/server/markdown-tiptap', () => ({
  markdownToTiptapJson: vi.fn(() => ({})),
  contentJsonToMarkdown: (_json: unknown, fallback: string) => fallback,
}))

vi.mock('@/lib/server/content/rehost-images', () => ({
  rehostExternalImages: (...args: unknown[]) =>
    rehostExternalImages(...(args as Parameters<typeof rehostExternalImages>)),
}))

// createPost runs a tier-limit gate after validation. Stub the
// resolver so this test focuses on author attribution, not enforcement.
vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(async () => ({ maxPosts: null, features: {} })),
}))

vi.mock('@/lib/server/domains/settings/settings.service', () => ({
  getPortalConfig: vi.fn(async () => ({ moderationDefault: { requireApproval: 'none' } })),
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: (...args: unknown[]) => recordAuditEvent(...args),
}))

describe('createPost author attribution', () => {
  beforeEach(() => {
    insertedRows.posts.length = 0
    insertedRows.post_votes.length = 0
    insertedRows.postTagAssignments.length = 0
    subscribeToPost.mockClear()
    txLockedBoardRows.value = [{ deletedAt: null, access: LOCKED_ANON_ACCESS }]
  })

  it('attributes the post row, the auto-upvote, and the subscription to author.principalId', async () => {
    const { createPost } = await import('../post.service')

    const overridePrincipal = 'principal_override' as unknown as PrincipalId
    await createPost(
      {
        boardId: 'board_b' as unknown as BoardId,
        title: 'New post',
        content: 'Body',
        statusId: 'status_open' as unknown as StatusId,
      },
      { principalId: overridePrincipal }
    )

    const postRow = insertedRows.posts[0] as { principalId: PrincipalId }
    const voteRow = insertedRows.post_votes[0] as { principalId: PrincipalId }
    expect(postRow.principalId).toBe(overridePrincipal)
    expect(voteRow.principalId).toBe(overridePrincipal)
    expect(subscribeToPost).toHaveBeenCalledWith(overridePrincipal, 'post_new', 'author')
  })
})

describe('createPost held audit event', () => {
  beforeEach(() => {
    insertedRows.posts.length = 0
    insertedRows.post_votes.length = 0
    insertedRows.postTagAssignments.length = 0
    subscribeToPost.mockClear()
    recordAuditEvent.mockClear()
    txLockedBoardRows.value = [{ deletedAt: null, access: LOCKED_ANON_ACCESS }]
  })

  it('records post.moderation.held when the post resolves to pending', async () => {
    const { db } = await import('@/lib/server/db')
    const { getPortalConfig } = await import('@/lib/server/domains/settings/settings.service')

    vi.mocked(db.query.boards.findFirst).mockResolvedValueOnce({
      id: 'board_b',
      slug: 'feedback',
      name: 'Feedback',
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'anonymous',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    } as unknown as Awaited<ReturnType<typeof db.query.boards.findFirst>>)
    // Workspace moderation policy requires approval for all submissions.
    vi.mocked(getPortalConfig).mockResolvedValueOnce({
      moderationDefault: { requireApproval: 'all' },
    } as unknown as Awaited<ReturnType<typeof getPortalConfig>>)

    const { createPost } = await import('../post.service')
    const principalId = 'principal_anon' as unknown as PrincipalId
    await createPost(
      {
        boardId: 'board_b' as unknown as BoardId,
        title: 'Held post',
        content: 'Body',
        statusId: 'status_open' as unknown as StatusId,
      },
      {
        principalId,
        actor: { principalId, role: null, principalType: 'anonymous', segmentIds: new Set() },
      }
    )

    expect(recordAuditEvent).toHaveBeenCalledOnce()
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'post.moderation.held',
        target: expect.objectContaining({ type: 'post' }),
        after: { moderationState: 'pending' },
      })
    )
  })

  it('does NOT record post.moderation.held when the post publishes immediately', async () => {
    const { db } = await import('@/lib/server/db')
    const { getPortalConfig } = await import('@/lib/server/domains/settings/settings.service')

    // Workspace moderation policy: no approval required
    vi.mocked(db.query.boards.findFirst).mockResolvedValueOnce({
      id: 'board_b',
      slug: 'feedback',
      name: 'Feedback',
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'anonymous',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    } as unknown as Awaited<ReturnType<typeof db.query.boards.findFirst>>)
    vi.mocked(getPortalConfig).mockResolvedValueOnce({
      moderationDefault: { requireApproval: 'none' },
    } as unknown as Awaited<ReturnType<typeof getPortalConfig>>)

    const { createPost } = await import('../post.service')
    const principalId = 'principal_user' as unknown as PrincipalId
    await createPost(
      {
        boardId: 'board_b' as unknown as BoardId,
        title: 'Published post',
        content: 'Body',
        statusId: 'status_open' as unknown as StatusId,
      },
      {
        principalId,
        actor: { principalId, role: null, principalType: 'user', segmentIds: new Set() },
      }
    )

    expect(recordAuditEvent).not.toHaveBeenCalled()
  })
})

describe('createPost dispatch guard (moderation)', () => {
  beforeEach(() => {
    insertedRows.posts.length = 0
    insertedRows.post_votes.length = 0
    insertedRows.postTagAssignments.length = 0
    subscribeToPost.mockClear()
    recordAuditEvent.mockClear()
    dispatchPostCreated.mockClear()
    syncPostMentions.mockClear()
    txLockedBoardRows.value = [{ deletedAt: null, access: LOCKED_ANON_ACCESS }]
  })

  it('does NOT call dispatchPostCreated when the post is held (moderationState=pending)', async () => {
    const { db } = await import('@/lib/server/db')
    const { getPortalConfig } = await import('@/lib/server/domains/settings/settings.service')

    vi.mocked(db.query.boards.findFirst).mockResolvedValueOnce({
      id: 'board_b',
      slug: 'feedback',
      name: 'Feedback',
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'anonymous',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    } as unknown as Awaited<ReturnType<typeof db.query.boards.findFirst>>)
    vi.mocked(getPortalConfig).mockResolvedValueOnce({
      moderationDefault: { requireApproval: 'all' },
    } as unknown as Awaited<ReturnType<typeof getPortalConfig>>)

    const { createPost } = await import('../post.service')
    const principalId = 'principal_anon' as unknown as PrincipalId
    await createPost(
      {
        boardId: 'board_b' as unknown as BoardId,
        title: 'Held post',
        content: 'Body',
        statusId: 'status_open' as unknown as StatusId,
      },
      {
        principalId,
        actor: { principalId, role: null, principalType: 'anonymous', segmentIds: new Set() },
      }
    )

    expect(dispatchPostCreated).not.toHaveBeenCalled()
  })

  it('calls dispatchPostCreated when the post publishes immediately', async () => {
    const { db } = await import('@/lib/server/db')
    const { getPortalConfig } = await import('@/lib/server/domains/settings/settings.service')

    vi.mocked(db.query.boards.findFirst).mockResolvedValueOnce({
      id: 'board_b',
      slug: 'feedback',
      name: 'Feedback',
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'anonymous',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    } as unknown as Awaited<ReturnType<typeof db.query.boards.findFirst>>)
    vi.mocked(getPortalConfig).mockResolvedValueOnce({
      moderationDefault: { requireApproval: 'none' },
    } as unknown as Awaited<ReturnType<typeof getPortalConfig>>)

    const { createPost } = await import('../post.service')
    const principalId = 'principal_user' as unknown as PrincipalId
    await createPost(
      {
        boardId: 'board_b' as unknown as BoardId,
        title: 'Published post',
        content: 'Body',
        statusId: 'status_open' as unknown as StatusId,
      },
      {
        principalId,
        actor: { principalId, role: null, principalType: 'user', segmentIds: new Set() },
      }
    )

    expect(dispatchPostCreated).toHaveBeenCalledOnce()
  })

  it('subscribeToPost runs even when post is held (author still subscribed)', async () => {
    const { db } = await import('@/lib/server/db')
    const { getPortalConfig } = await import('@/lib/server/domains/settings/settings.service')

    vi.mocked(db.query.boards.findFirst).mockResolvedValueOnce({
      id: 'board_b',
      slug: 'feedback',
      name: 'Feedback',
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'anonymous',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    } as unknown as Awaited<ReturnType<typeof db.query.boards.findFirst>>)
    vi.mocked(getPortalConfig).mockResolvedValueOnce({
      moderationDefault: { requireApproval: 'all' },
    } as unknown as Awaited<ReturnType<typeof getPortalConfig>>)

    const { createPost } = await import('../post.service')
    const principalId = 'principal_anon' as unknown as PrincipalId
    await createPost(
      {
        boardId: 'board_b' as unknown as BoardId,
        title: 'Held post',
        content: 'Body',
        statusId: 'status_open' as unknown as StatusId,
      },
      {
        principalId,
        actor: { principalId, role: null, principalType: 'anonymous', segmentIds: new Set() },
      }
    )

    expect(subscribeToPost).toHaveBeenCalledWith(principalId, 'post_new', 'author')
  })
})

describe('createPost TOCTOU board re-check', () => {
  beforeEach(() => {
    insertedRows.posts.length = 0
    insertedRows.post_votes.length = 0
    insertedRows.postTagAssignments.length = 0
    subscribeToPost.mockClear()
    rehostExternalImages.mockClear()
    txLockedBoardRows.value = [{ deletedAt: null, access: LOCKED_ANON_ACCESS }]
  })

  it('rejects a soft-deleted board in the precheck BEFORE rehostExternalImages runs (no S3 leak)', async () => {
    // The precheck filters isNull(boards.deletedAt). When the row is already
    // soft-deleted at the start of createPost, findFirst returns undefined and
    // the request must throw BOARD_NOT_FOUND BEFORE rehostExternalImages is
    // invoked — otherwise the S3 uploads orphan when the (later) locked
    // re-check throws.
    const { db } = await import('@/lib/server/db')
    vi.mocked(db.query.boards.findFirst).mockResolvedValueOnce(undefined)

    const { createPost } = await import('../post.service')
    const principalId = 'principal_user' as unknown as PrincipalId

    await expect(
      createPost(
        {
          boardId: 'board_b' as unknown as BoardId,
          title: 'Pre-deleted post',
          content: 'Body',
          statusId: 'status_open' as unknown as StatusId,
        },
        { principalId }
      )
    ).rejects.toThrow(/BOARD_NOT_FOUND|not found/i)

    // The S3 rehost path must never run when the board fails the precheck.
    expect(rehostExternalImages).not.toHaveBeenCalled()
    // And nothing must reach the DB either.
    expect(insertedRows.posts).toHaveLength(0)
    expect(insertedRows.post_votes).toHaveLength(0)
  })

  it('throws BOARD_NOT_FOUND when the board is soft-deleted between the precheck and the locked re-check', async () => {
    // Simulate the race: the initial findFirst returned a live board (default
    // mock above), but by the time the transaction acquires the row lock the
    // board has been soft-deleted by a concurrent admin action. The locked
    // SELECT now filters isNull(boards.deletedAt) in SQL, so the lock returns
    // zero rows for a soft-deleted board.
    txLockedBoardRows.value = []

    const { createPost } = await import('../post.service')
    const principalId = 'principal_user' as unknown as PrincipalId

    await expect(
      createPost(
        {
          boardId: 'board_b' as unknown as BoardId,
          title: 'Racy post',
          content: 'Body',
          statusId: 'status_open' as unknown as StatusId,
        },
        { principalId }
      )
    ).rejects.toThrow(/BOARD_NOT_FOUND|not found/i)

    // The insert must not have run.
    expect(insertedRows.posts).toHaveLength(0)
    expect(insertedRows.post_votes).toHaveLength(0)
  })

  it('throws BOARD_NOT_FOUND when the locked re-check returns no rows (board hard-deleted)', async () => {
    txLockedBoardRows.value = []

    const { createPost } = await import('../post.service')
    const principalId = 'principal_user' as unknown as PrincipalId

    await expect(
      createPost(
        {
          boardId: 'board_b' as unknown as BoardId,
          title: 'Racy post',
          content: 'Body',
          statusId: 'status_open' as unknown as StatusId,
        },
        { principalId }
      )
    ).rejects.toThrow(/BOARD_NOT_FOUND|not found/i)

    expect(insertedRows.posts).toHaveLength(0)
    expect(insertedRows.post_votes).toHaveLength(0)
  })
})
