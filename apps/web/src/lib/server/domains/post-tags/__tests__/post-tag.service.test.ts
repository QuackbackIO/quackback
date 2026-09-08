/**
 * Tag portal visibility at the service layer.
 *
 * `listPublicPostTags` is the portal's tag catalog. Non-team viewers must only
 * receive tags marked public; team actors get everything (they assign internal
 * tags from the portal too). Create/update persist the flag, defaulting new
 * tags to public so behaviour is unchanged for admins who never touch it.
 *
 * Pure unit test — the db module is stubbed with tagging operators so the
 * `where` shape can be asserted without a database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostTagId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'

const mockEq = vi.fn((col, val) => ({ _tag: 'eq', col, val }))
const mockAnd = vi.fn((...args) => ({ _tag: 'and', args }))
const mockIsNull = vi.fn((col) => ({ _tag: 'isNull', col }))
const mockAsc = vi.fn((col) => ({ _tag: 'asc', col }))

const mockPostTags = {
  id: Symbol('postTags.id'),
  name: Symbol('postTags.name'),
  isPublic: Symbol('postTags.isPublic'),
  deletedAt: Symbol('postTags.deletedAt'),
}

const mockFindMany = vi.fn()
const mockFindFirst = vi.fn()
const mockInsertReturning = vi.fn()
const mockInsertValues = vi.fn(() => ({ returning: mockInsertReturning }))
const mockUpdateReturning = vi.fn()
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }))
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { postTags: { findMany: mockFindMany, findFirst: mockFindFirst } },
    insert: vi.fn(() => ({ values: mockInsertValues })),
    update: vi.fn(() => ({ set: mockUpdateSet })),
  },
  eq: mockEq,
  and: mockAnd,
  isNull: mockIsNull,
  asc: mockAsc,
  postTags: mockPostTags,
  boards: {},
  postTagAssignments: {},
  posts: {},
}))

const TEAM_ACTOR: Actor = {
  principalId: 'principal_team' as PrincipalId,
  role: 'admin',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set(),
}

const CUSTOMER_ACTOR: Actor = {
  principalId: 'principal_customer' as PrincipalId,
  role: 'user',
  principalType: 'user',
  segmentIds: new Set(),
  permissions: new Set(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindMany.mockResolvedValue([])
})

describe('listPublicPostTags — portal visibility', () => {
  it('restricts to public, non-deleted tags for an anonymous viewer (default actor)', async () => {
    const { listPublicPostTags } = await import('../post-tag.service')

    await listPublicPostTags()

    const { where } = mockFindMany.mock.calls[0][0]
    expect(where).toEqual({
      _tag: 'and',
      args: [
        { _tag: 'isNull', col: mockPostTags.deletedAt },
        { _tag: 'eq', col: mockPostTags.isPublic, val: true },
      ],
    })
  })

  it('restricts to public tags for a signed-in customer', async () => {
    const { listPublicPostTags } = await import('../post-tag.service')

    await listPublicPostTags(CUSTOMER_ACTOR)

    expect(mockEq).toHaveBeenCalledWith(mockPostTags.isPublic, true)
  })

  it('returns every non-deleted tag for a team actor', async () => {
    const { listPublicPostTags } = await import('../post-tag.service')

    await listPublicPostTags(TEAM_ACTOR)

    const { where } = mockFindMany.mock.calls[0][0]
    expect(where).toEqual({ _tag: 'isNull', col: mockPostTags.deletedAt })
    expect(mockEq).not.toHaveBeenCalledWith(mockPostTags.isPublic, true)
  })
})

describe('createPostTag — isPublic', () => {
  it('defaults new tags to public when the flag is omitted', async () => {
    mockInsertReturning.mockResolvedValue([{ id: 'post_tag_1', isPublic: true }])
    const { createPostTag } = await import('../post-tag.service')

    await createPostTag({ name: 'Bug' })

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ isPublic: true }))
  })

  it('persists an explicit internal flag', async () => {
    mockInsertReturning.mockResolvedValue([{ id: 'post_tag_1', isPublic: false }])
    const { createPostTag } = await import('../post-tag.service')

    await createPostTag({ name: 'Churn risk', isPublic: false })

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ isPublic: false }))
  })
})

describe('updatePostTag — isPublic', () => {
  beforeEach(() => {
    mockFindFirst.mockResolvedValue({ id: 'post_tag_1', name: 'Bug', isPublic: true })
    mockUpdateReturning.mockResolvedValue([{ id: 'post_tag_1', isPublic: false }])
  })

  it('writes isPublic when provided', async () => {
    const { updatePostTag } = await import('../post-tag.service')

    await updatePostTag('post_tag_1' as PostTagId, { isPublic: false })

    expect(mockUpdateSet).toHaveBeenCalledWith({ isPublic: false })
  })

  it('leaves isPublic untouched when omitted', async () => {
    const { updatePostTag } = await import('../post-tag.service')

    await updatePostTag('post_tag_1' as PostTagId, { color: '#ef4444' })

    expect(mockUpdateSet).toHaveBeenCalledWith({ color: '#ef4444' })
  })
})
