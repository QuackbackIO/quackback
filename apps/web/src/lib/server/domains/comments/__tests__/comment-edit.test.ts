import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CommentId, PrincipalId } from '@quackback/ids'
import { NotFoundError, ForbiddenError, ValidationError } from '@/lib/shared/errors'

// ── Mock state ────────────────────────────────────────────────────────────────

const mockFindFirst = vi.fn()
const mockFindMany = vi.fn()
const mockTransaction = vi.fn()
const mockDispatchCommentUpdated = vi.fn()

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      comments: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
  comments: { id: 'id', parentId: 'parent_id' },
  commentEditHistory: {},
  posts: {},
}))

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchCommentUpdated: (...args: unknown[]) => mockDispatchCommentUpdated(...args),
  buildEventActor: vi.fn(() => ({ type: 'user', id: 'mock_actor' })),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity: vi.fn(),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMMENT_ID = 'comment_test123' as unknown as CommentId
const AUTHOR_ID = 'principal_author' as unknown as PrincipalId
const OTHER_ID = 'principal_other' as unknown as PrincipalId

const baseComment = {
  id: COMMENT_ID,
  postId: 'post_test',
  content: 'Original content',
  principalId: AUTHOR_ID,
  isTeamMember: false,
  isPrivate: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: null,
  deletedAt: null,
  parentId: null,
  post: {
    id: 'post_test',
    title: 'Test Post',
    board: { id: 'board_test', slug: 'test-board', name: 'Test Board' },
  },
}

const updatedComment = {
  ...baseComment,
  content: 'Updated content',
  updatedAt: new Date('2026-01-02'),
}

const authorActor = { principalId: AUTHOR_ID, role: 'user' as const }
const adminActor = {
  principalId: 'principal_admin' as unknown as PrincipalId,
  role: 'admin' as const,
}

function makeTx(returningRows: unknown[] = [updatedComment]) {
  return {
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue(returningRows),
        })),
      })),
    })),
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirst.mockResolvedValue(baseComment)
  mockFindMany.mockResolvedValue([])
  mockTransaction.mockImplementation(
    async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx())
  )
})

// ── canEditComment ────────────────────────────────────────────────────────────

describe('canEditComment', () => {
  it('allows the author when no team member has replied', async () => {
    const { canEditComment } = await import('../comment.permissions')
    expect(await canEditComment(COMMENT_ID, authorActor)).toEqual({ allowed: true })
  })

  it('allows a team member (admin) to edit any comment', async () => {
    const { canEditComment } = await import('../comment.permissions')
    expect(await canEditComment(COMMENT_ID, adminActor)).toEqual({ allowed: true })
  })

  it('denies a non-author user', async () => {
    const { canEditComment } = await import('../comment.permissions')
    const result = await canEditComment(COMMENT_ID, { principalId: OTHER_ID, role: 'user' })
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/own comments/i)
  })

  it('denies editing a deleted comment', async () => {
    mockFindFirst.mockResolvedValueOnce({ ...baseComment, deletedAt: new Date() })
    const { canEditComment } = await import('../comment.permissions')
    const result = await canEditComment(COMMENT_ID, authorActor)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/deleted/i)
  })

  it('throws NotFoundError when the comment does not exist', async () => {
    mockFindFirst.mockResolvedValueOnce(null)
    const { canEditComment } = await import('../comment.permissions')
    await expect(canEditComment(COMMENT_ID, authorActor)).rejects.toThrow(NotFoundError)
  })

  it('denies when a team member has already replied', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'reply_1', isTeamMember: true, parentId: COMMENT_ID, deletedAt: null },
    ])
    const { canEditComment } = await import('../comment.permissions')
    const result = await canEditComment(COMMENT_ID, authorActor)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/team member/i)
  })
})

// ── userEditComment ───────────────────────────────────────────────────────────

describe('userEditComment', () => {
  it('updates comment content and returns the updated comment', async () => {
    const { userEditComment } = await import('../comment.permissions')
    const result = await userEditComment(COMMENT_ID, 'Updated content', authorActor)
    expect(result.content).toBe('Updated content')
    expect(result.id).toBe(COMMENT_ID)
  })

  it('wraps the history insert and content update in a single transaction', async () => {
    const { userEditComment } = await import('../comment.permissions')
    await userEditComment(COMMENT_ID, 'Updated content', authorActor)
    expect(mockTransaction).toHaveBeenCalledOnce()
  })

  it('inserts an edit history record inside the transaction', async () => {
    let insertValuesCalled = false
    mockTransaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => {
        const tx = makeTx()
        const origInsert = tx.insert.bind(tx)
        tx.insert = vi.fn((...args) => {
          const chain = origInsert(...args)
          const origValues = chain.values.bind(chain)
          chain.values = vi.fn((...vArgs) => {
            insertValuesCalled = true
            return origValues(...vArgs)
          })
          return chain
        })
        return fn(tx)
      }
    )

    const { userEditComment } = await import('../comment.permissions')
    await userEditComment(COMMENT_ID, 'Updated content', authorActor)
    expect(insertValuesCalled).toBe(true)
  })

  it('dispatches a comment.updated event after the transaction completes', async () => {
    const { userEditComment } = await import('../comment.permissions')
    await userEditComment(COMMENT_ID, 'Updated content', authorActor)

    expect(mockDispatchCommentUpdated).toHaveBeenCalledOnce()
    expect(mockDispatchCommentUpdated).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: COMMENT_ID }),
      expect.objectContaining({ id: 'post_test', boardId: 'board_test' })
    )
  })

  it('does not dispatch event when the transaction fails', async () => {
    mockTransaction.mockRejectedValue(new Error('DB error'))
    const { userEditComment } = await import('../comment.permissions')
    await expect(userEditComment(COMMENT_ID, 'Updated content', authorActor)).rejects.toThrow()
    expect(mockDispatchCommentUpdated).not.toHaveBeenCalled()
  })

  it('throws ForbiddenError when the actor is not allowed to edit', async () => {
    const { userEditComment } = await import('../comment.permissions')
    await expect(
      userEditComment(COMMENT_ID, 'Updated', { principalId: OTHER_ID, role: 'user' })
    ).rejects.toThrow(ForbiddenError)
  })

  it('throws ValidationError for empty content', async () => {
    const { userEditComment } = await import('../comment.permissions')
    await expect(userEditComment(COMMENT_ID, '', authorActor)).rejects.toThrow(ValidationError)
    await expect(userEditComment(COMMENT_ID, '   ', authorActor)).rejects.toThrow(ValidationError)
  })

  it('throws ValidationError when content exceeds 5000 characters', async () => {
    const { userEditComment } = await import('../comment.permissions')
    await expect(userEditComment(COMMENT_ID, 'x'.repeat(5001), authorActor)).rejects.toThrow(
      ValidationError
    )
  })

  it('throws NotFoundError when the update affects no rows (concurrent deletion race)', async () => {
    mockTransaction.mockImplementation(
      async (fn: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => fn(makeTx([]))
    )
    const { userEditComment } = await import('../comment.permissions')
    await expect(userEditComment(COMMENT_ID, 'Updated', authorActor)).rejects.toThrow(NotFoundError)
  })
})
