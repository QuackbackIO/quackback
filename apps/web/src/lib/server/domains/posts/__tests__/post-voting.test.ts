/**
 * Tests for post voting service — removeVote and addVoteOnBehalf.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PrincipalId } from '@quackback/ids'

// --- Mock tracking ---
const mockDbExecute = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      execute: (...args: unknown[]) => mockDbExecute(...args),
    },
    sql: realSql,
    eq: vi.fn(),
    and: vi.fn(),
    desc: vi.fn(),
  }
})

vi.mock('@/lib/server/utils', () => ({
  getExecuteRows: vi.fn((result: unknown) => result as unknown[]),
}))

vi.mock('@quackback/ids', async (importOriginal) => {
  const original = await importOriginal<typeof import('@quackback/ids')>()
  return {
    ...original,
    toUuid: vi.fn((id: string) => id),
    createId: vi.fn((prefix: string) => `${prefix}_generated`),
  }
})

// Import after mocks
const { removeVote, addVoteOnBehalf, voteOnPost } = await import('../post.voting')

const POST_ID = 'post_01test' as PostId
const PRINCIPAL_ID = 'principal_01voter' as PrincipalId
const ADMIN_ID = 'principal_01admin' as PrincipalId

describe('removeVote', () => {
  beforeEach(() => {
    mockDbExecute.mockReset()
  })

  it('removes a vote and decrements count', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: true, deleted: true, vote_count: 4 },
    ])

    const result = await removeVote(POST_ID, PRINCIPAL_ID)

    expect(result.removed).toBe(true)
    expect(result.voteCount).toBe(4)
    expect(mockDbExecute).toHaveBeenCalledTimes(1)
  })

  it('returns removed: false when no vote existed', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: true, deleted: false, vote_count: 5 },
    ])

    const result = await removeVote(POST_ID, PRINCIPAL_ID)

    expect(result.removed).toBe(false)
    expect(result.voteCount).toBe(5)
  })

  it('throws POST_NOT_FOUND when post does not exist', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: false, board_exists: false, deleted: false, vote_count: 0 },
    ])

    await expect(removeVote(POST_ID, PRINCIPAL_ID)).rejects.toThrow('not found')
  })

  it('handles zero vote count (underflow protection)', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: true, deleted: true, vote_count: 0 },
    ])

    const result = await removeVote(POST_ID, PRINCIPAL_ID)

    expect(result.removed).toBe(true)
    expect(result.voteCount).toBe(0)
  })

  it('throws BOARD_NOT_FOUND when board does not exist', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: false, deleted: false, vote_count: 0 },
    ])

    await expect(removeVote(POST_ID, PRINCIPAL_ID)).rejects.toThrow('Board not found')
  })

  it('does not report a deletion when post does not exist (delete guarded by post_check/board_check)', async () => {
    // The DELETE in the CTE is itself gated on EXISTS(post_check) AND EXISTS(board_check),
    // so a missing post can never report deleted: true even if the mock forgets to say so.
    mockDbExecute.mockResolvedValue([
      { post_exists: false, board_exists: false, deleted: false, vote_count: 0 },
    ])

    await expect(removeVote(POST_ID, PRINCIPAL_ID)).rejects.toThrow('not found')
  })

  it('DELETE clause is guarded by EXISTS(post_check) AND EXISTS(board_check)', async () => {
    // Guard against regression: removing a vote on a soft-deleted/non-existent
    // post or board must not be able to mutate the vote row at the SQL level,
    // independent of what the app-layer checks do afterward.
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: true, deleted: true, vote_count: 1 },
    ])
    await removeVote(POST_ID, PRINCIPAL_ID)

    const sqlArg = mockDbExecute.mock.calls[0]?.[0] as { queryChunks?: unknown[] } | undefined
    const raw = (sqlArg?.queryChunks ?? [])
      .map((c: unknown) => {
        const v = (c as { value?: unknown } | null)?.value
        return Array.isArray(v) ? v.join(' ') : ''
      })
      .join(' ')
    const deleteClause = raw.slice(raw.indexOf('DELETE FROM'), raw.indexOf('RETURNING'))
    expect(deleteClause).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM post_check\s*\)/i)
    expect(deleteClause).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM board_check\s*\)/i)
  })
})

describe('addVoteOnBehalf', () => {
  beforeEach(() => {
    mockDbExecute.mockReset()
  })

  it('adds a proxy vote successfully', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: true, newly_voted: true, vote_count: 6 },
    ])

    const result = await addVoteOnBehalf(
      POST_ID,
      PRINCIPAL_ID,
      { type: 'proxy', externalUrl: '' },
      null,
      ADMIN_ID
    )

    expect(result.voted).toBe(true)
    expect(result.voteCount).toBe(6)
  })

  it('returns voted: false when vote already exists (idempotent)', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: true, newly_voted: false, vote_count: 5 },
    ])

    const result = await addVoteOnBehalf(POST_ID, PRINCIPAL_ID)

    expect(result.voted).toBe(false)
    expect(result.voteCount).toBe(5)
  })

  it('throws POST_NOT_FOUND when post does not exist', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: false, board_exists: false, newly_voted: false, vote_count: 0 },
    ])

    await expect(addVoteOnBehalf(POST_ID, PRINCIPAL_ID)).rejects.toThrow('not found')
  })

  it('throws BOARD_NOT_FOUND when board does not exist', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: false, newly_voted: false, vote_count: 0 },
    ])

    await expect(addVoteOnBehalf(POST_ID, PRINCIPAL_ID)).rejects.toThrow('Board not found')
  })

  it('passes source metadata to the CTE', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: true, newly_voted: true, vote_count: 3 },
    ])

    const result = await addVoteOnBehalf(
      POST_ID,
      PRINCIPAL_ID,
      { type: 'zendesk', externalUrl: 'https://zendesk.com/ticket/123' },
      null,
      ADMIN_ID
    )

    expect(result.voted).toBe(true)
    expect(mockDbExecute).toHaveBeenCalledTimes(1)
  })

  it('board_check CTE filters soft-deleted boards (deleted_at IS NULL)', async () => {
    // Guard against accidental regression: addVoteOnBehalf must reject inserts
    // when the target board has been soft-deleted (board_check returns no row).
    // We inspect the SQL chunks rather than running against Postgres.
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: false, newly_voted: false, vote_count: 0 },
    ])

    await expect(addVoteOnBehalf(POST_ID, PRINCIPAL_ID)).rejects.toThrow(/Board not found/)
    const sqlArg = mockDbExecute.mock.calls[0]?.[0] as { queryChunks?: unknown[] } | undefined
    const raw = (sqlArg?.queryChunks ?? [])
      .map((c: unknown) => {
        const v = (c as { value?: unknown } | null)?.value
        return Array.isArray(v) ? v.join(' ') : ''
      })
      .join(' ')
    expect(raw).toMatch(/deleted_at\s+IS\s+NULL/i)
  })
})

describe('voteOnPost — board_check filters soft-deleted boards', () => {
  beforeEach(() => {
    mockDbExecute.mockReset()
  })

  it('throws BOARD_NOT_FOUND when board_check returns no rows (soft-deleted board)', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: false, newly_voted: false, vote_count: 0 },
    ])
    await expect(voteOnPost(POST_ID, PRINCIPAL_ID)).rejects.toThrow(/Board not found/)
    const sqlArg = mockDbExecute.mock.calls[0]?.[0] as { queryChunks?: unknown[] } | undefined
    const raw = (sqlArg?.queryChunks ?? [])
      .map((c: unknown) => {
        const v = (c as { value?: unknown } | null)?.value
        return Array.isArray(v) ? v.join(' ') : ''
      })
      .join(' ')
    expect(raw).toMatch(/deleted_at\s+IS\s+NULL/i)
  })
})

describe('voteOnPost — toggle-off (delete) branch guards post/board existence', () => {
  beforeEach(() => {
    mockDbExecute.mockReset()
  })

  it('throws POST_NOT_FOUND when toggling off a vote on a soft-deleted/non-existent post', async () => {
    // post_check finds no row for a deleted/missing post, so newly_voted stays
    // false and no vote row should be touched — the CTE-level guard, not app
    // code, is what stops the DELETE from running.
    mockDbExecute.mockResolvedValue([
      { post_exists: false, board_exists: false, newly_voted: false, vote_count: 0 },
    ])

    await expect(voteOnPost(POST_ID, PRINCIPAL_ID)).rejects.toThrow('not found')
    expect(mockDbExecute).toHaveBeenCalledTimes(1)
  })

  it('throws BOARD_NOT_FOUND when toggling off a vote whose board is soft-deleted', async () => {
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: false, newly_voted: false, vote_count: 0 },
    ])

    await expect(voteOnPost(POST_ID, PRINCIPAL_ID)).rejects.toThrow(/Board not found/)
  })

  it('DELETE (toggle-off) clause is guarded by EXISTS(post_check) AND EXISTS(board_check)', async () => {
    // Mirrors the insert branch's guard: the delete branch of the toggle must not
    // be able to remove a vote row unless both the post and its board exist.
    mockDbExecute.mockResolvedValue([
      { post_exists: true, board_exists: true, newly_voted: false, vote_count: 2 },
    ])
    await voteOnPost(POST_ID, PRINCIPAL_ID)

    const sqlArg = mockDbExecute.mock.calls[0]?.[0] as { queryChunks?: unknown[] } | undefined
    const raw = (sqlArg?.queryChunks ?? [])
      .map((c: unknown) => {
        const v = (c as { value?: unknown } | null)?.value
        return Array.isArray(v) ? v.join(' ') : ''
      })
      .join(' ')
    const deleteClause = raw.slice(
      raw.indexOf('DELETE FROM'),
      raw.indexOf('RETURNING', raw.indexOf('DELETE FROM'))
    )
    expect(deleteClause).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM post_check\s*\)/i)
    expect(deleteClause).toMatch(/EXISTS\s*\(\s*SELECT 1 FROM board_check\s*\)/i)
  })
})
