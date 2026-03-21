/**
 * Tests for post voting service — removeVote and addVoteOnBehalf.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PostId, PrincipalId } from '@quackback/ids'

// --- Mock tracking ---
const mockDbExecute = vi.fn()

vi.mock('@/lib/server/db', async () => {
  const { sql: realSql } = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')

  return {
    db: {
      execute: (...args: unknown[]) => mockDbExecute(...args),
    },
    posts: { id: 'post_id' },
    votes: {
      postId: 'post_id',
      principalId: 'principal_id',
      sourceType: 'source_type',
      sourceExternalUrl: 'source_external_url',
      feedbackSuggestionId: 'feedback_suggestion_id',
      addedByPrincipalId: 'added_by_principal_id',
    },
    postSubscriptions: { id: 'id', postId: 'post_id', principalId: 'principal_id' },
    boards: { id: 'board_id' },
    principal: { id: 'principal_id' },
    user: { id: 'user_id' },
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
const { removeVote, addVoteOnBehalf } = await import('../post.voting')

const POST_ID = 'post_01test' as PostId
const PRINCIPAL_ID = 'principal_01voter' as PrincipalId
const ADMIN_ID = 'principal_01admin' as PrincipalId

describe('removeVote', () => {
  beforeEach(() => {
    mockDbExecute.mockReset()
  })

  it('removes a vote and decrements count', async () => {
    mockDbExecute.mockResolvedValue([{ post_exists: true, deleted: true, vote_count: 4 }])

    const result = await removeVote(POST_ID, PRINCIPAL_ID)

    expect(result.removed).toBe(true)
    expect(result.voteCount).toBe(4)
    expect(mockDbExecute).toHaveBeenCalledTimes(1)
  })

  it('returns removed: false when no vote existed', async () => {
    mockDbExecute.mockResolvedValue([{ post_exists: true, deleted: false, vote_count: 5 }])

    const result = await removeVote(POST_ID, PRINCIPAL_ID)

    expect(result.removed).toBe(false)
    expect(result.voteCount).toBe(5)
  })

  it('throws POST_NOT_FOUND when post does not exist', async () => {
    mockDbExecute.mockResolvedValue([{ post_exists: false, deleted: false, vote_count: 0 }])

    await expect(removeVote(POST_ID, PRINCIPAL_ID)).rejects.toThrow('not found')
  })

  it('handles zero vote count (underflow protection)', async () => {
    mockDbExecute.mockResolvedValue([{ post_exists: true, deleted: true, vote_count: 0 }])

    const result = await removeVote(POST_ID, PRINCIPAL_ID)

    expect(result.removed).toBe(true)
    expect(result.voteCount).toBe(0)
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
})
