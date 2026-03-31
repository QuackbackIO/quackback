import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId, BoardId, PrincipalId } from '@quackback/ids'

const createActivity = vi.fn()
const mockPostsFindFirst = vi.fn()
const mockBoardsFindFirst = vi.fn()

const updateReturning = vi.fn()
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn(() => ({ where: updateWhere }))
const dbUpdate = vi.fn(() => ({ set: updateSet }))

vi.mock('@/lib/server/db', async () => {
  return {
    db: {
      query: {
        posts: { findFirst: (...args: unknown[]) => mockPostsFindFirst(...args) },
        boards: { findFirst: (...args: unknown[]) => mockBoardsFindFirst(...args) },
      },
      update: dbUpdate,
    },
    boards: { id: 'board_id' },
    eq: vi.fn(),
    posts: { id: 'post_id' },
  }
})

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity,
}))

const actor = {
  principalId: 'principal_abc' as PrincipalId,
  email: 'admin@example.com',
  displayName: 'Admin',
}

describe('changeBoard', () => {
  beforeEach(() => {
    createActivity.mockClear()
    mockPostsFindFirst.mockReset()
    mockBoardsFindFirst.mockReset()
    updateReturning.mockReset()
    dbUpdate.mockClear()
  })

  it('throws POST_NOT_FOUND when post does not exist', async () => {
    mockPostsFindFirst.mockResolvedValue(null)
    const { changeBoard } = await import('../post.board')
    await expect(changeBoard('post_999' as PostId, 'board_new' as BoardId, actor)).rejects.toThrow(
      'Post with ID post_999 not found'
    )
  })

  it('throws BOARD_NOT_FOUND when current board does not exist', async () => {
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    // Promise.all order: [currentBoard, newBoard]
    mockBoardsFindFirst
      .mockResolvedValueOnce(null) // currentBoard
      .mockResolvedValueOnce({ id: 'board_new', name: 'New Board', slug: 'new' })
    const { changeBoard } = await import('../post.board')
    await expect(changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)).rejects.toThrow(
      'Board with ID board_old not found'
    )
  })

  it('throws BOARD_NOT_FOUND when new board does not exist', async () => {
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    // Promise.all order: [currentBoard, newBoard]
    mockBoardsFindFirst
      .mockResolvedValueOnce({ id: 'board_old', name: 'Old Board', slug: 'old' })
      .mockResolvedValueOnce(null) // newBoard
    const { changeBoard } = await import('../post.board')
    await expect(changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)).rejects.toThrow(
      'Board with ID board_new not found'
    )
  })

  it('updates boardId and returns updated post', async () => {
    const updatedPost = { id: 'post_123', boardId: 'board_new', title: 'Test' }
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    mockBoardsFindFirst
      .mockResolvedValueOnce({ id: 'board_old', name: 'Old Board', slug: 'old' })
      .mockResolvedValueOnce({ id: 'board_new', name: 'New Board', slug: 'new' })
    updateReturning.mockResolvedValue([updatedPost])
    const { changeBoard } = await import('../post.board')
    const result = await changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)
    expect(result).toEqual(updatedPost)
  })

  it('creates a post.board_changed activity with from/to board names', async () => {
    const updatedPost = { id: 'post_123', boardId: 'board_new' }
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    mockBoardsFindFirst
      .mockResolvedValueOnce({ id: 'board_old', name: 'Old Board', slug: 'old' })
      .mockResolvedValueOnce({ id: 'board_new', name: 'New Board', slug: 'new' })
    updateReturning.mockResolvedValue([updatedPost])
    const { changeBoard } = await import('../post.board')
    await changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)
    expect(createActivity).toHaveBeenCalledWith({
      postId: 'post_123',
      principalId: actor.principalId,
      type: 'post.board_changed',
      metadata: {
        fromBoardId: 'board_old',
        fromBoardName: 'Old Board',
        toBoardId: 'board_new',
        toBoardName: 'New Board',
      },
    })
  })

  it('does not call createActivity when DB update returns empty', async () => {
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    mockBoardsFindFirst
      .mockResolvedValueOnce({ id: 'board_old', name: 'Old Board', slug: 'old' })
      .mockResolvedValueOnce({ id: 'board_new', name: 'New Board', slug: 'new' })
    updateReturning.mockResolvedValue([])
    const { changeBoard } = await import('../post.board')
    await expect(changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)).rejects.toThrow(
      'Post with ID post_123 not found'
    )
    expect(createActivity).not.toHaveBeenCalled()
  })

  it('returns existing post without update when board is unchanged', async () => {
    const existingPost = { id: 'post_123', boardId: 'board_same', title: 'Test' }
    mockPostsFindFirst.mockResolvedValue(existingPost)
    const { changeBoard } = await import('../post.board')
    const result = await changeBoard('post_123' as PostId, 'board_same' as BoardId, actor)
    expect(result).toEqual(existingPost)
    expect(dbUpdate).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })
})
