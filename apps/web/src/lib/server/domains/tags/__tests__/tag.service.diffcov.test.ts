/**
 * Differential-coverage tests for tag.service — create/update/delete validation
 * (name, length, duplicate, hex color), soft-delete snapshot + not-found,
 * getById/list, board-scoped tags, and public-list error wrapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  tagsFindMany: vi.fn(),
  tagsFindFirst: vi.fn(),
  boardsFindFirst: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  selectDistinctWhere: vi.fn(),
  dCreated: vi.fn(),
  dUpdated: vi.fn(),
  dDeleted: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      tags: { findMany: m.tagsFindMany, findFirst: m.tagsFindFirst },
      boards: { findFirst: m.boardsFindFirst },
    },
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: m.updateReturning }) }) }),
    selectDistinct: () => ({
      from: () => ({
        innerJoin: () => ({ innerJoin: () => ({ where: () => m.selectDistinctWhere() }) }),
      }),
    }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  asc: vi.fn(),
  tags: { id: 't.id', name: 't.name', deletedAt: 't.deletedAt' },
  boards: { id: 'b.id' },
  postTags: { tagId: 'pt.tagId', postId: 'pt.postId' },
  posts: { id: 'p.id', boardId: 'p.boardId', deletedAt: 'p.deletedAt' },
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn() }) },
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchTagCreated: (...a: unknown[]) => m.dCreated(...a),
  dispatchTagUpdated: (...a: unknown[]) => m.dUpdated(...a),
  dispatchTagDeleted: (...a: unknown[]) => m.dDeleted(...a),
}))

import {
  createTag,
  updateTag,
  deleteTag,
  getTagById,
  listTags,
  getTagsByBoard,
  listPublicTags,
} from '../tag.service'

const tag = (over: Record<string, unknown> = {}) => ({
  id: 'tag_1',
  name: 'Bug',
  color: '#6b7280',
  description: null,
  createdAt: new Date('2026-01-01'),
  deletedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.tagsFindMany.mockResolvedValue([])
  m.tagsFindFirst.mockResolvedValue(undefined)
  m.boardsFindFirst.mockResolvedValue({ id: 'board_1' })
  m.insertReturning.mockResolvedValue([tag()])
  m.updateReturning.mockResolvedValue([tag()])
  m.selectDistinctWhere.mockResolvedValue([])
  m.dCreated.mockResolvedValue(undefined)
  m.dUpdated.mockResolvedValue(undefined)
  m.dDeleted.mockResolvedValue(undefined)
})

describe('createTag', () => {
  it('requires a name and caps length', async () => {
    await expect(createTag({ name: ' ' } as never)).rejects.toThrow('name is required')
    await expect(createTag({ name: 'x'.repeat(51) } as never)).rejects.toThrow('50 characters')
  })
  it('rejects a duplicate name', async () => {
    m.tagsFindMany.mockResolvedValueOnce([tag({ name: 'Bug' })])
    await expect(createTag({ name: 'bug' } as never)).rejects.toThrow('already exists')
  })
  it('rejects an invalid color', async () => {
    await expect(createTag({ name: 'New', color: 'red' } as never)).rejects.toThrow('valid hex')
  })
  it('creates with a default color and dispatches', async () => {
    const t = await createTag({ name: ' New ', description: ' d ' } as never)
    expect(t).toEqual(tag())
    expect(m.dCreated).toHaveBeenCalled()
  })
})

describe('updateTag', () => {
  it('throws when missing', async () => {
    m.tagsFindFirst.mockResolvedValueOnce(undefined)
    await expect(updateTag('tag_1' as never, { name: 'x' } as never)).rejects.toThrow('not found')
  })
  it('rejects empty / over-long name and duplicate', async () => {
    m.tagsFindFirst.mockResolvedValue(tag())
    await expect(updateTag('tag_1' as never, { name: ' ' } as never)).rejects.toThrow(
      'cannot be empty'
    )
    await expect(updateTag('tag_1' as never, { name: 'x'.repeat(51) } as never)).rejects.toThrow(
      '50 characters'
    )
    m.tagsFindMany.mockResolvedValueOnce([tag({ id: 'other', name: 'Dup' })])
    await expect(updateTag('tag_1' as never, { name: 'dup' } as never)).rejects.toThrow(
      'already exists'
    )
  })
  it('rejects an invalid color', async () => {
    m.tagsFindFirst.mockResolvedValueOnce(tag())
    await expect(updateTag('tag_1' as never, { color: 'nope' } as never)).rejects.toThrow(
      'valid hex'
    )
  })
  it('updates all fields and dispatches', async () => {
    m.tagsFindFirst.mockResolvedValueOnce(tag())
    await updateTag(
      'tag_1' as never,
      { name: ' New ', color: '#000000', description: ' d ' } as never
    )
    expect(m.dUpdated).toHaveBeenCalled()
  })
  it('throws when the update matches no row', async () => {
    m.tagsFindFirst.mockResolvedValueOnce(tag())
    m.updateReturning.mockResolvedValueOnce([])
    await expect(updateTag('tag_1' as never, { color: '#000000' } as never)).rejects.toThrow(
      'not found'
    )
  })
})

describe('deleteTag', () => {
  it('throws when the tag is already gone', async () => {
    m.updateReturning.mockResolvedValueOnce([])
    await expect(deleteTag('tag_1' as never)).rejects.toThrow('not found')
  })
  it('soft-deletes and dispatches when a snapshot exists', async () => {
    m.tagsFindFirst.mockResolvedValueOnce(tag())
    m.updateReturning.mockResolvedValueOnce([tag()])
    await deleteTag('tag_1' as never)
    expect(m.dDeleted).toHaveBeenCalled()
  })
})

describe('getters', () => {
  it('getTagById throws when missing, returns when found', async () => {
    await expect(getTagById('tag_1' as never)).rejects.toThrow('not found')
    m.tagsFindFirst.mockResolvedValueOnce(tag())
    expect(await getTagById('tag_1' as never)).toEqual(tag())
  })
  it('listTags returns the rows', async () => {
    m.tagsFindMany.mockResolvedValueOnce([tag()])
    expect(await listTags()).toEqual([tag()])
  })
})

describe('getTagsByBoard', () => {
  it('throws when the board is missing', async () => {
    m.boardsFindFirst.mockResolvedValueOnce(undefined)
    await expect(getTagsByBoard('board_1' as never)).rejects.toThrow('not found')
  })
  it('returns empty when no tags are used', async () => {
    m.selectDistinctWhere.mockResolvedValueOnce([])
    expect(await getTagsByBoard('board_1' as never)).toEqual([])
  })
  it('returns the used tags', async () => {
    m.selectDistinctWhere.mockResolvedValueOnce([{ id: 'tag_1' }])
    m.tagsFindMany.mockResolvedValueOnce([tag()])
    expect(await getTagsByBoard('board_1' as never)).toEqual([tag()])
  })
})

describe('listPublicTags', () => {
  it('returns rows', async () => {
    m.tagsFindMany.mockResolvedValueOnce([tag()])
    expect(await listPublicTags()).toEqual([tag()])
  })
  it('wraps errors in InternalError', async () => {
    m.tagsFindMany.mockRejectedValueOnce(new Error('db down'))
    await expect(listPublicTags()).rejects.toThrow('Failed to fetch tags')
  })
})
