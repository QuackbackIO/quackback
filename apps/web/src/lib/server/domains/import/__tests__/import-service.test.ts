/**
 * Tests for the CSV import batch pipeline (§I1/§I2): the auto-tag wiring
 * (every post a commit run creates also carries the run's batch tag) and
 * source-id idempotence (a matched external link updates instead of
 * duplicating).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  findFirstPostStatuses: vi.fn(),
  findManyPostStatuses: vi.fn(),
  findManyPostTags: vi.fn(),
  findManyBoards: vi.fn(),
  findManyPostExternalLinks: vi.fn(),
  insertValues: vi.fn(),
  onConflictDoNothing: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  deleteWhere: vi.fn(),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      postStatuses: {
        findFirst: hoisted.findFirstPostStatuses,
        findMany: hoisted.findManyPostStatuses,
      },
      postTags: {
        findMany: hoisted.findManyPostTags,
      },
      boards: {
        findMany: hoisted.findManyBoards,
      },
      postExternalLinks: {
        findMany: hoisted.findManyPostExternalLinks,
      },
    },
    insert: (_table: unknown) => ({
      values: (...args: unknown[]) => {
        hoisted.insertValues(...args)
        return { onConflictDoNothing: hoisted.onConflictDoNothing }
      },
    }),
    update: (_table: unknown) => ({
      set: (...args: unknown[]) => {
        hoisted.updateSet(...args)
        return { where: hoisted.updateWhere }
      },
    }),
    delete: (_table: unknown) => ({
      where: hoisted.deleteWhere,
    }),
  },
  posts: { id: 'posts.id' },
  postTags: {},
  postTagAssignments: { postId: 'post_tag_assignments.post_id' },
  postStatuses: { isDefault: 'is_default', slug: 'slug' },
  postExternalLinks: { integrationType: 'integration_type', externalId: 'external_id' },
  postVotes: { postId: 'post_votes.post_id', sourceType: 'post_votes.source_type' },
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  inArray: (...args: unknown[]) => ({ inArray: args }),
}))

import { processBatch } from '../import-service'
import type { ImportUserResolver } from '../user-resolver'

function fakeResolver(principalId: PrincipalId): ImportUserResolver {
  return {
    resolve: vi.fn().mockResolvedValue(principalId),
    flushPendingCreates: vi.fn().mockResolvedValue(0),
    get pendingCount() {
      return 0
    },
  } as unknown as ImportUserResolver
}

/** Resolves each distinct email to its own principal id, for voter tests. */
function emailKeyedResolver(fallback: PrincipalId): ImportUserResolver {
  const byEmail = new Map<string, PrincipalId>()
  return {
    resolve: vi.fn(async (email: string | null) => {
      if (!email) return fallback
      if (!byEmail.has(email)) byEmail.set(email, `principal_${email}` as PrincipalId)
      return byEmail.get(email)!
    }),
    flushPendingCreates: vi.fn().mockResolvedValue(0),
    get pendingCount() {
      return 0
    },
  } as unknown as ImportUserResolver
}

describe('processBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.findFirstPostStatuses.mockResolvedValue(undefined)
    hoisted.findManyPostStatuses.mockResolvedValue([])
    hoisted.findManyPostTags.mockResolvedValue([])
    hoisted.findManyBoards.mockResolvedValue([])
    hoisted.findManyPostExternalLinks.mockResolvedValue([])
    hoisted.onConflictDoNothing.mockResolvedValue(undefined)
    hoisted.updateWhere.mockResolvedValue(undefined)
    hoisted.deleteWhere.mockResolvedValue(undefined)
  })

  describe('batch auto-tag', () => {
    it('applies the batch tag to every created post alongside its own tags', async () => {
      const rows = [{ title: 'Row one', content: 'Body one', tags: 'feature' }]

      await processBatch(
        rows,
        'board_1' as never,
        0,
        fakeResolver('principal_fallback' as PrincipalId),
        'principal_fallback' as PrincipalId,
        'post_tag_batch' as never
      )

      // First insert() call is the new tag ("feature"); the assignments insert
      // is the last insert() call and must include the batch tag for the post.
      const assignmentsCall = hoisted.insertValues.mock.calls.at(-1)![0] as {
        postId: string
        tagId: string
      }[]
      expect(assignmentsCall).toEqual(
        expect.arrayContaining([expect.objectContaining({ tagId: 'post_tag_batch' })])
      )
    })

    it('omits the batch tag entirely when none is passed (dry-run / legacy path)', async () => {
      const rows = [{ title: 'Row one', content: 'Body one' }]

      await processBatch(
        rows,
        'board_1' as never,
        0,
        fakeResolver('principal_fallback' as PrincipalId),
        'principal_fallback' as PrincipalId
      )

      // No row tags and no batch tag: the assignments insert never runs, so
      // only the posts insert happens (no tags to create either).
      expect(hoisted.insertValues).toHaveBeenCalledTimes(1)
    })
  })

  describe('source-id idempotence', () => {
    it('creates a new post and an external link when the source_id has not been seen before', async () => {
      hoisted.findManyPostExternalLinks.mockResolvedValue([])
      const rows = [{ title: 'Row one', content: 'Body one', source_id: 'ext-1' }]

      const result = await processBatch(
        rows,
        'board_1' as never,
        0,
        fakeResolver('principal_fallback' as PrincipalId),
        'principal_fallback' as PrincipalId
      )

      expect(result.imported).toBe(1)
      expect(result.updated).toBe(0)
      // posts insert + post_external_links insert
      const postExternalLinkCall = hoisted.insertValues.mock.calls.find((call) => {
        const arg = call[0] as { integrationType?: string }[] | { integrationType?: string }
        return Array.isArray(arg)
          ? arg.some((row) => row.integrationType === 'import')
          : arg.integrationType === 'import'
      })
      expect(postExternalLinkCall).toBeDefined()
    })

    it('updates the existing post instead of creating a duplicate when source_id matches', async () => {
      hoisted.findManyPostExternalLinks.mockResolvedValue([
        { externalId: 'ext-1', postId: 'post_existing' },
      ])
      const rows = [{ title: 'Updated title', content: 'Updated body', source_id: 'ext-1' }]

      const result = await processBatch(
        rows,
        'board_1' as never,
        0,
        fakeResolver('principal_fallback' as PrincipalId),
        'principal_fallback' as PrincipalId
      )

      expect(result.imported).toBe(0)
      expect(result.updated).toBe(1)
      expect(hoisted.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated title', content: 'Updated body' })
      )
      expect(hoisted.deleteWhere).toHaveBeenCalled()
    })
  })

  describe('real voter import (§I3)', () => {
    it('creates real post_votes rows and sets voteCount from the deduped voter count', async () => {
      hoisted.findManyPostExternalLinks.mockResolvedValue([])
      const rows = [{ title: 'Dark mode', content: 'Please', source_id: 'idea-1', vote_count: '99' }]
      const voters = {
        'idea-1': [
          { email: 'alice@example.com' },
          { email: 'bob@example.com' },
          { email: 'alice@example.com' }, // duplicate email, deduped
        ],
      }

      const result = await processBatch(
        rows,
        'board_1' as never,
        0,
        emailKeyedResolver('principal_fallback' as PrincipalId),
        'principal_fallback' as PrincipalId,
        undefined,
        voters
      )

      expect(result.imported).toBe(1)
      // vote_count column (99) is ignored in favor of the real, deduped count.
      const postInsertCall = hoisted.insertValues.mock.calls.find((call) => {
        const arg = call[0] as { title?: string }[]
        return Array.isArray(arg) && arg[0]?.title === 'Dark mode'
      })!
      expect((postInsertCall[0] as { voteCount: number }[])[0].voteCount).toBe(2)

      const voteInsertCall = hoisted.insertValues.mock.calls.find((call) => {
        const arg = call[0] as { sourceType?: string }[]
        return Array.isArray(arg) && arg[0]?.sourceType === 'import'
      })
      expect(voteInsertCall).toBeDefined()
      const voteRows = voteInsertCall![0] as { principalId: string }[]
      expect(voteRows).toHaveLength(2)
    })

    it('falls back to vote-count backfill when no voters entry exists for the row', async () => {
      hoisted.findManyPostExternalLinks.mockResolvedValue([])
      const rows = [{ title: 'No voters here', content: 'Body', source_id: 'idea-2', vote_count: '5' }]

      await processBatch(
        rows,
        'board_1' as never,
        0,
        emailKeyedResolver('principal_fallback' as PrincipalId),
        'principal_fallback' as PrincipalId,
        undefined,
        { 'idea-1': [{ email: 'alice@example.com' }] } // keyed to a different row
      )

      const postInsertCall = hoisted.insertValues.mock.calls.find((call) => {
        const arg = call[0] as { title?: string }[]
        return Array.isArray(arg) && arg[0]?.title === 'No voters here'
      })!
      expect((postInsertCall[0] as { voteCount: number }[])[0].voteCount).toBe(5)
    })

    it('replaces prior import-sourced votes when updating a matched row', async () => {
      hoisted.findManyPostExternalLinks.mockResolvedValue([
        { externalId: 'idea-1', postId: 'post_existing' },
      ])
      const rows = [{ title: 'Dark mode v2', content: 'Please', source_id: 'idea-1' }]
      const voters = { 'idea-1': [{ email: 'carol@example.com' }] }

      const result = await processBatch(
        rows,
        'board_1' as never,
        0,
        emailKeyedResolver('principal_fallback' as PrincipalId),
        'principal_fallback' as PrincipalId,
        undefined,
        voters
      )

      expect(result.updated).toBe(1)
      expect(hoisted.updateSet).toHaveBeenCalledWith(expect.objectContaining({ voteCount: 1 }))
      expect(hoisted.deleteWhere).toHaveBeenCalled()
      const voteInsertCall = hoisted.insertValues.mock.calls.find((call) => {
        const arg = call[0] as { sourceType?: string }[]
        return Array.isArray(arg) && arg[0]?.sourceType === 'import'
      })
      expect(voteInsertCall).toBeDefined()
    })
  })
})
