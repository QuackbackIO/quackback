/**
 * Defensive policy gating on `getPublicBoardById`.
 *
 * Previously the function returned the board row regardless of the
 * caller's permissions. Every current caller happened to apply
 * `canViewBoard` afterward, but a future caller adding the function
 * to a new endpoint could silently leak team-only or segment-only
 * boards. The fix makes the policy check a property of the function
 * itself: return null when the actor can't view the board.
 *
 * The sibling `getPublicBoardBySlug` has had this contract since the
 * policy layer landed; this test brings the byId variant in line.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BoardId, PrincipalId, SegmentId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy'

const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      boards: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
  boards: { id: 'boards.id', deletedAt: 'boards.deletedAt' },
  posts: {},
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
  and: vi.fn((...parts) => ({ kind: 'and', parts })),
  isNull: vi.fn((col) => ({ kind: 'isNull', col })),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}))

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    principalId: 'prn_test' as PrincipalId,
    role: 'user',
    principalType: 'user',
    segmentIds: new Set<SegmentId>(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getPublicBoardById — defensive policy check', () => {
  it('returns the board for a team actor regardless of audience', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'brd_team' as BoardId,
      access: {
        view: 'team',
        vote: 'team',
        comment: 'team',
        submit: 'team',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    })
    const { getPublicBoardById } = await import('../board.public')
    const result = await getPublicBoardById('brd_team' as BoardId, actor({ role: 'admin' }))
    expect(result?.id).toBe('brd_team')
  })

  it('returns null when the audience is team and the actor is a portal user', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'brd_team' as BoardId,
      access: {
        view: 'team',
        vote: 'team',
        comment: 'team',
        submit: 'team',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    })
    const { getPublicBoardById } = await import('../board.public')
    const result = await getPublicBoardById('brd_team' as BoardId, actor({ role: 'user' }))
    expect(result).toBeNull()
  })

  it('returns null when the audience is segments and the actor is not in any', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'brd_seg' as BoardId,
      access: {
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: {
          view: ['seg_alpha'],
          vote: ['seg_alpha'],
          comment: ['seg_alpha'],
          submit: ['seg_alpha'],
        },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    })
    const { getPublicBoardById } = await import('../board.public')
    const result = await getPublicBoardById('brd_seg' as BoardId, actor({ role: 'user' }))
    expect(result).toBeNull()
  })

  it('returns the board for a segments-audience match', async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: 'brd_seg' as BoardId,
      access: {
        view: 'segments',
        vote: 'segments',
        comment: 'segments',
        submit: 'segments',
        segments: {
          view: ['seg_alpha'],
          vote: ['seg_alpha'],
          comment: ['seg_alpha'],
          submit: ['seg_alpha'],
        },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    })
    const { getPublicBoardById } = await import('../board.public')
    const result = await getPublicBoardById(
      'brd_seg' as BoardId,
      actor({ role: 'user', segmentIds: new Set(['seg_alpha' as SegmentId]) })
    )
    expect(result?.id).toBe('brd_seg')
  })

  it('returns null when the board does not exist', async () => {
    mockFindFirst.mockResolvedValueOnce(undefined)
    const { getPublicBoardById } = await import('../board.public')
    const result = await getPublicBoardById('brd_missing' as BoardId, actor())
    expect(result).toBeNull()
  })

  it('filters soft-deleted boards in the SQL WHERE (parity with getPublicBoardBySlug)', async () => {
    // Regression: the byId helper used to call `eq(boards.id, ...)` without
    // an `isNull(boards.deletedAt)` predicate. Soft-deleted boards would then
    // round-trip through canViewBoard and be returned to callers — most
    // notably createPublicPostFn, which would happily accept new posts on a
    // deleted board. The sibling getPublicBoardBySlug has had the guard for
    // a long time; this test brings the byId variant in line.
    mockFindFirst.mockResolvedValueOnce({
      id: 'brd_x' as BoardId,
      access: {
        view: 'anonymous',
        vote: 'anonymous',
        comment: 'anonymous',
        submit: 'anonymous',
        segments: { view: [], vote: [], comment: [], submit: [] },
        moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
      },
    })
    const { getPublicBoardById } = await import('../board.public')
    await getPublicBoardById('brd_x' as BoardId, actor())

    expect(mockFindFirst).toHaveBeenCalledTimes(1)
    const arg = mockFindFirst.mock.calls[0][0] as { where: unknown }
    // The query must use `and(eq(id, ...), isNull(deletedAt))`, not bare eq.
    expect(arg.where).toMatchObject({
      kind: 'and',
      parts: expect.arrayContaining([
        expect.objectContaining({ kind: 'eq', col: 'boards.id' }),
        expect.objectContaining({ kind: 'isNull', col: 'boards.deletedAt' }),
      ]),
    })
  })
})
