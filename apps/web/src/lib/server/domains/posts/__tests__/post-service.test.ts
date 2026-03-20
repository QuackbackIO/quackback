import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId, PrincipalId, StatusId, TagId } from '@quackback/ids'

const createActivity = vi.fn()
const dispatchPostStatusChanged = vi.fn()
const buildEventActor = vi.fn((actor) => actor)

const mockPostsFindFirst = vi.fn()
const mockBoardsFindFirst = vi.fn()
const mockPostStatusesFindFirst = vi.fn()
const mockPrincipalFindFirst = vi.fn()

const selectWhere = vi.fn()
const selectFrom = vi.fn(() => ({ where: selectWhere }))
const dbSelect = vi.fn(() => ({ from: selectFrom }))

const updateReturning = vi.fn()
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn(() => ({ where: updateWhere }))
const dbUpdate = vi.fn(() => ({ set: updateSet }))

const deleteWhere = vi.fn()
const dbDelete = vi.fn(() => ({ where: deleteWhere }))

const insertValues = vi.fn()
const dbInsert = vi.fn(() => ({ values: insertValues }))

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  const postTagsTable = { postId: 'post_id', tagId: 'tag_id', __name: 'postTags' }
  const tagsTable = { id: 'tag_id', name: 'tag_name', __name: 'tags' }

  return {
    db: {
      query: {
        posts: { findFirst: (...args: unknown[]) => mockPostsFindFirst(...args) },
        boards: { findFirst: (...args: unknown[]) => mockBoardsFindFirst(...args) },
        postStatuses: { findFirst: (...args: unknown[]) => mockPostStatusesFindFirst(...args) },
        principal: { findFirst: (...args: unknown[]) => mockPrincipalFindFirst(...args) },
      },
      select: dbSelect,
      update: dbUpdate,
      delete: dbDelete,
      insert: dbInsert,
    },
    boards: { id: 'board_id' },
    eq: vi.fn(),
    inArray: vi.fn(),
    postStatuses: { id: 'status_id' },
    posts: { id: 'post_id' },
    postTags: postTagsTable,
    tags: tagsTable,
    principal: { id: 'principal_id' },
    sql: realSql,
  }
})

vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchPostCreated: vi.fn(),
  dispatchPostStatusChanged,
  dispatchPostUpdated: vi.fn(),
  buildEventActor,
}))

vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  subscribeToPost: vi.fn(),
}))

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity,
}))

describe('post.service updatePost', () => {
  beforeEach(() => {
    createActivity.mockClear()
    dispatchPostStatusChanged.mockClear()
    buildEventActor.mockClear()
    mockPostsFindFirst.mockReset()
    mockBoardsFindFirst.mockReset()
    mockPostStatusesFindFirst.mockReset()
    mockPrincipalFindFirst.mockReset()
    selectWhere.mockReset()
    updateReturning.mockReset()
    deleteWhere.mockReset()
    insertValues.mockReset()

    mockPostsFindFirst.mockResolvedValue({
      id: 'post_123' as PostId,
      title: 'Original title',
      content: 'Original content',
      contentJson: null,
      boardId: 'board_123',
      statusId: 'status_open',
      ownerPrincipalId: 'principal_prev',
      updatedAt: new Date(),
    })
    mockBoardsFindFirst.mockResolvedValue({
      id: 'board_123',
      slug: 'feedback',
    })
    mockPostStatusesFindFirst
      .mockResolvedValueOnce({
        id: 'status_open',
        name: 'Open',
        color: '#888888',
      })
      .mockResolvedValueOnce({
        id: 'status_closed',
        name: 'Closed',
        color: '#111111',
      })
    selectWhere.mockResolvedValueOnce([{ tagId: 'tag_old' as TagId }]).mockResolvedValueOnce([
      { id: 'tag_old' as TagId, name: 'Old tag' },
      { id: 'tag_new' as TagId, name: 'New tag' },
    ])
    updateReturning.mockResolvedValue([
      {
        id: 'post_123' as PostId,
        title: 'Original title',
        content: 'Original content',
        contentJson: null,
        boardId: 'board_123',
        statusId: 'status_closed' as StatusId,
        ownerPrincipalId: 'principal_next' as PrincipalId,
        updatedAt: new Date(),
      },
    ])
    mockPrincipalFindFirst
      .mockResolvedValueOnce({ displayName: 'Next Owner' })
      .mockResolvedValueOnce({ displayName: 'Previous Owner' })
  })

  it('requires an actor for post updates', async () => {
    const { updatePost } = await import('../post.service')

    await expect(
      updatePost('post_123' as PostId, { title: 'Updated title' }, undefined as never)
    ).rejects.toThrow('Actor principal ID is required')
  })

  it('records status, owner, and tag activity for API-style updates', async () => {
    const { updatePost } = await import('../post.service')

    await updatePost(
      'post_123' as PostId,
      {
        statusId: 'status_closed' as StatusId,
        ownerPrincipalId: 'principal_next' as PrincipalId,
        tagIds: ['tag_new' as TagId],
      },
      {
        principalId: 'principal_actor' as PrincipalId,
      }
    )

    expect(buildEventActor).toHaveBeenCalledWith({ principalId: 'principal_actor' })
    expect(dispatchPostStatusChanged).toHaveBeenCalledTimes(1)
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'principal_actor',
        type: 'status.changed',
        metadata: expect.objectContaining({
          fromName: 'Open',
          toName: 'Closed',
        }),
      })
    )
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'principal_actor',
        type: 'owner.assigned',
        metadata: expect.objectContaining({
          ownerName: 'Next Owner',
          previousOwnerName: 'Previous Owner',
        }),
      })
    )
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'principal_actor',
        type: 'tags.added',
        metadata: { tagNames: ['New tag'] },
      })
    )
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        principalId: 'principal_actor',
        type: 'tags.removed',
        metadata: { tagNames: ['Old tag'] },
      })
    )
  })
})
