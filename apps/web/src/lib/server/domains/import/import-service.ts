/**
 * CSV import commit pipeline.
 *
 * Creates tags/posts (and, for rows carrying a source_id that matches a
 * prior import's post_external_links row, UPDATES the existing post instead
 * of duplicating it — §I2 idempotence). Row validation/resolution is shared
 * with the dry-run preview via `import-row-resolver.ts`.
 */

import Papa from 'papaparse'
import { z } from 'zod'
import {
  db,
  boards,
  posts,
  postStatuses,
  postTags,
  postTagAssignments,
  postExternalLinks,
  postVotes,
  eq,
  and,
  inArray,
} from '@/lib/server/db'
import {
  boardIdSchema,
  createId,
  type BoardId,
  type PostId,
  type PostTagId,
  type PostVoteId,
  type PrincipalId,
} from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import type { ImportInput, ImportResult, ImportRowError, ImportVoterRecord } from './types'
import { ImportUserResolver } from './user-resolver'
import { BATCH_SIZE, IMPORT_LINK_TYPE, loadRowContext, resolveRows } from './import-row-resolver'

/** integration_type/sourceType tag on post_votes rows this pipeline creates. */
const VOTE_SOURCE_TYPE = 'import'

// Constants
export const MAX_ERRORS = 100

/**
 * Job data validation schema
 */
export const jobDataSchema = z.object({
  boardId: boardIdSchema,
  csvContent: z.string().min(1, 'CSV content is required'),
  totalRows: z.number().int().positive(),
})

/**
 * Result from processing a single batch of rows.
 */
export interface BatchResult {
  imported: number
  updated: number
  skipped: number
  errors: ImportRowError[]
  createdTags: string[]
  createdStatuses: string[]
  createdBoards: string[]
}

/**
 * Parse CSV content from base64-encoded string.
 */
export function parseCSV(csvContent: string): Record<string, string>[] {
  // Decode CSV content from base64
  const csvText = Buffer.from(csvContent, 'base64').toString('utf-8')

  // Parse CSV
  const parseResult = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  if (parseResult.errors.length > 0) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `CSV parsing failed: ${parseResult.errors[0].message}`
    )
  }

  return parseResult.data
}

/**
 * Validate import input data.
 */
export function validateImportInput(
  data: ImportInput
): { success: true } | { success: false; error: string } {
  const validated = jobDataSchema.safeParse(data)
  if (!validated.success) {
    return { success: false, error: validated.error.issues[0].message }
  }
  return { success: true }
}

/**
 * Process a batch of CSV rows.
 *
 * This is the core business logic that processes a batch of rows,
 * creating tags and posts in the database. Rows carrying a `source_id` that
 * matches a prior import's post_external_links row are UPDATED in place
 * instead of creating a duplicate (§I2 idempotence).
 *
 * Note: This implementation is compatible with neon-http driver which does NOT
 * support interactive transactions. We pre-generate all IDs using TypeIDs (UUIDv7)
 * and build all insert data upfront before executing sequential inserts.
 */
export async function processBatch(
  rows: Record<string, string>[],
  defaultBoardId: BoardId,
  startIndex: number,
  userResolver: ImportUserResolver,
  fallbackPrincipalId: PrincipalId,
  batchTagId?: PostTagId | null,
  voters?: Record<string, ImportVoterRecord[]>
): Promise<BatchResult> {
  const result: BatchResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    createdTags: [],
    createdStatuses: [],
    createdBoards: [],
  }

  const ctx = await loadRowContext()
  const tagsToCreate = new Set<string>()
  const statusesToCreate = new Map<string, string>()
  const boardsToCreate = new Map<string, string>()

  const { validRows, errors, skipped } = await resolveRows(
    rows,
    defaultBoardId,
    startIndex,
    userResolver,
    fallbackPrincipalId,
    ctx,
    tagsToCreate,
    statusesToCreate,
    boardsToCreate
  )
  result.errors = errors
  result.skipped = skipped

  // Auto-create boards/statuses the CSV references but that don't exist yet
  // (template-driven CSV flow: unknown values become new taxonomy with
  // schema-default access/settings, mirroring tag auto-creation below).
  // Direct inserts — deliberately not createBoard/createStatusFn, so bulk
  // imports don't fan out board/status events per row.
  for (const [slug, name] of boardsToCreate) {
    if (ctx.boardMap.has(slug)) continue
    const id = createId('board')
    await db.insert(boards).values({ id, name, slug })
    ctx.boardMap.set(slug, { id, slug })
    result.createdBoards.push(name)
  }

  let statusPosition = ctx.nextActiveStatusPosition
  for (const [slug, name] of statusesToCreate) {
    if (ctx.statusMap.has(slug)) continue
    const id = createId('post_status')
    await db.insert(postStatuses).values({
      id,
      name,
      slug,
      color: '#6b7280',
      category: 'active',
      position: statusPosition++,
    })
    ctx.statusMap.set(slug, { id, category: 'active', slug, name })
    result.createdStatuses.push(name)
  }

  // Point rows that referenced not-yet-existing values at the fresh ids.
  for (const { row } of validRows) {
    if (row.pendingBoardSlug) {
      const board = ctx.boardMap.get(row.pendingBoardSlug)
      if (board) {
        row.boardId = board.id
        row.boardSlug = board.slug
      }
    }
    if (row.pendingStatusSlug) {
      const status = ctx.statusMap.get(row.pendingStatusSlug)
      if (status) {
        row.statusId = status.id
        row.statusLabel = status.name
      }
    }
  }

  // Idempotence: match rows carrying a source_id against prior import links.
  const sourceIds = validRows.map(({ row }) => row.sourceId).filter((id): id is string => !!id)
  const existingLinks =
    sourceIds.length > 0
      ? await db.query.postExternalLinks.findMany({
          where: and(
            eq(postExternalLinks.integrationType, IMPORT_LINK_TYPE),
            inArray(postExternalLinks.externalId, sourceIds)
          ),
        })
      : []
  const existingBySourceId = new Map(existingLinks.map((l) => [l.externalId, l.postId]))

  const toInsert = validRows.filter(
    ({ row }) => !row.sourceId || !existingBySourceId.has(row.sourceId)
  )
  const toUpdate = validRows.filter(
    ({ row }) => row.sourceId && existingBySourceId.has(row.sourceId)
  )

  // Pre-generate IDs for all new tags (neon-http compatible approach)
  const tagsToCreateArray = Array.from(tagsToCreate)
  const newTagIds = tagsToCreateArray.map(() => createId('post_tag'))
  const newTagsWithIds = tagsToCreateArray.map((name, index) => ({
    id: newTagIds[index],
    name,
    color: '#6b7280',
  }))
  const tagMap = ctx.tagMap
  for (const newTag of newTagsWithIds) {
    tagMap.set(newTag.name.toLowerCase(), { id: newTag.id })
  }

  // Pre-generate IDs for genuinely new posts only.
  const newPostIds = toInsert.map(() => createId('post'))

  // Real per-row voters (§I3): resolve each voter to a principal BEFORE the
  // flush below so their user+member rows land in the same batch insert.
  // Rows whose source_id has no entry here fall back to vote-count backfill.
  const votersBySourceId = new Map<string, { principalId: PrincipalId; createdAt: Date | null }[]>()
  if (voters) {
    for (const { row } of validRows) {
      if (!row.sourceId) continue
      const rowVoters = voters[row.sourceId]
      if (!rowVoters?.length) continue
      const seen = new Set<PrincipalId>()
      const resolved: { principalId: PrincipalId; createdAt: Date | null }[] = []
      for (const voter of rowVoters) {
        const principalId = await userResolver.resolve(
          voter.email,
          voter.name ?? null,
          fallbackPrincipalId
        )
        if (seen.has(principalId)) continue
        seen.add(principalId)
        resolved.push({
          principalId,
          createdAt: voter.createdAt ? new Date(voter.createdAt) : null,
        })
      }
      votersBySourceId.set(row.sourceId, resolved)
    }
  }

  // Flush any pending user+member creations before inserting posts
  await userResolver.flushPendingCreates()

  const postsToInsert = toInsert.map(({ row }, index) => {
    const rowVoters = row.sourceId ? votersBySourceId.get(row.sourceId) : undefined
    return {
      id: newPostIds[index],
      boardId: row.boardId,
      title: row.title,
      content: row.content,
      statusId: row.statusId,
      principalId: row.principalId,
      voteCount: rowVoters ? rowVoters.length : row.voteCount,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    }
  })

  const externalLinksToInsert = toInsert
    .map(({ row }, index) => ({ row, postId: newPostIds[index] }))
    .filter(({ row }) => !!row.sourceId)
    .map(({ row, postId }) => ({
      id: createId('post_external_link'),
      postId,
      integrationType: IMPORT_LINK_TYPE,
      externalId: row.sourceId!,
      status: 'active',
    }))

  const postTagsToInsert: { postId: PostId; tagId: PostTagId }[] = []
  const postVotesToInsert: {
    id: PostVoteId
    postId: PostId
    principalId: PrincipalId
    sourceType: string
    createdAt: Date
  }[] = []
  for (let i = 0; i < toInsert.length; i++) {
    const { row } = toInsert[i]
    const postId = newPostIds[i]
    for (const tagName of row.tagNames) {
      const tag = tagMap.get(tagName.toLowerCase())
      if (tag) postTagsToInsert.push({ postId, tagId: tag.id })
    }
    if (batchTagId) postTagsToInsert.push({ postId, tagId: batchTagId })

    const rowVoters = row.sourceId ? votersBySourceId.get(row.sourceId) : undefined
    for (const voter of rowVoters ?? []) {
      postVotesToInsert.push({
        id: createId('post_vote'),
        postId,
        principalId: voter.principalId,
        sourceType: VOTE_SOURCE_TYPE,
        createdAt: voter.createdAt ?? row.createdAt,
      })
    }
  }

  // Insert new tags first
  if (newTagsWithIds.length > 0) {
    await db.insert(postTags).values(newTagsWithIds)
    result.createdTags = tagsToCreateArray
  }

  // Insert genuinely new posts
  if (postsToInsert.length > 0) {
    await db.insert(posts).values(postsToInsert)
    result.imported = postsToInsert.length
  }

  if (externalLinksToInsert.length > 0) {
    await db.insert(postExternalLinks).values(externalLinksToInsert)
  }

  if (postTagsToInsert.length > 0) {
    await db.insert(postTagAssignments).values(postTagsToInsert).onConflictDoNothing()
  }

  if (postVotesToInsert.length > 0) {
    await db.insert(postVotes).values(postVotesToInsert).onConflictDoNothing()
  }

  // Update rows matched by source_id: re-import overwrites content/status/
  // votes and replaces the tag set (including the batch tag) rather than
  // creating a duplicate post.
  for (const { row } of toUpdate) {
    const postId = existingBySourceId.get(row.sourceId!)!
    const rowVoters = row.sourceId ? votersBySourceId.get(row.sourceId) : undefined
    await db
      .update(posts)
      .set({
        title: row.title,
        content: row.content,
        statusId: row.statusId,
        voteCount: rowVoters ? rowVoters.length : row.voteCount,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, postId))

    if (rowVoters) {
      // Replace this post's prior import-sourced votes with the fresh set —
      // mirrors the tag-replacement behavior below rather than accumulating.
      await db
        .delete(postVotes)
        .where(and(eq(postVotes.postId, postId), eq(postVotes.sourceType, VOTE_SOURCE_TYPE)))
      if (rowVoters.length > 0) {
        await db
          .insert(postVotes)
          .values(
            rowVoters.map((voter) => ({
              id: createId('post_vote'),
              postId,
              principalId: voter.principalId,
              sourceType: VOTE_SOURCE_TYPE,
              createdAt: voter.createdAt ?? row.createdAt,
            }))
          )
          .onConflictDoNothing()
      }
    }

    await db.delete(postTagAssignments).where(eq(postTagAssignments.postId, postId))
    const updateTagRows: { postId: PostId; tagId: PostTagId }[] = []
    for (const tagName of row.tagNames) {
      const tag = tagMap.get(tagName.toLowerCase())
      if (tag) updateTagRows.push({ postId, tagId: tag.id })
    }
    if (batchTagId) updateTagRows.push({ postId, tagId: batchTagId })
    if (updateTagRows.length > 0) {
      await db.insert(postTagAssignments).values(updateTagRows).onConflictDoNothing()
    }
  }
  result.updated = toUpdate.length

  return result
}

/**
 * Merge batch results into cumulative results.
 */
export function mergeResults(current: ImportResult, batch: BatchResult): ImportResult {
  return {
    imported: current.imported + batch.imported,
    updated: current.updated + batch.updated,
    skipped: current.skipped + batch.skipped,
    errors: [...current.errors, ...batch.errors].slice(0, MAX_ERRORS),
    createdTags: [...new Set([...current.createdTags, ...batch.createdTags])],
    createdStatuses: [...new Set([...current.createdStatuses, ...batch.createdStatuses])],
    createdBoards: [...new Set([...current.createdBoards, ...batch.createdBoards])],
  }
}

/**
 * Process an entire CSV import.
 */
export async function processImport(data: ImportInput): Promise<ImportResult> {
  const validation = validateImportInput(data)
  if (!validation.success) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid import data: ${validation.error}`)
  }

  const rows = parseCSV(data.csvContent)
  let result: ImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    createdTags: [],
    createdStatuses: [],
    createdBoards: [],
  }

  // Single UserResolver instance shared across all batches (caches email->principalId lookups)
  const userResolver = new ImportUserResolver()

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const batchResult = await processBatch(
      batch,
      data.boardId,
      i,
      userResolver,
      data.initiatedByPrincipalId,
      data.batchTagId,
      data.voters
    )
    result = mergeResults(result, batchResult)
  }

  return result
}
