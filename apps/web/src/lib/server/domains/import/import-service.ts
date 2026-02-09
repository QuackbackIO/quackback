/**
 * CSV import processing service.
 *
 * This module contains the business logic for CSV import processing.
 */

import Papa from 'papaparse'
import { z } from 'zod'
import { db, posts, tags, postTags, postStatuses, eq } from '@/lib/server/db'
import {
  boardIdSchema,
  createId,
  type BoardId,
  type PrincipalId,
  type PostId,
  type TagId,
  type StatusId,
} from '@quackback/ids'
import type { ImportInput, ImportResult, ImportRowError } from './types'
import { ImportUserResolver } from './user-resolver'

// Constants
export const MAX_ERRORS = 100
export const MAX_TAGS_PER_POST = 20
export const BATCH_SIZE = 100

/**
 * Job data validation schema
 */
export const jobDataSchema = z.object({
  boardId: boardIdSchema,
  csvContent: z.string().min(1, 'CSV content is required'),
  totalRows: z.number().int().positive(),
})

/**
 * CSV row validation schema
 */
export const csvRowSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  content: z.string().max(10000, 'Content must be 10000 characters or less'),
  status: z.string().optional(),
  tags: z.string().optional(),
  board: z.string().optional(),
  author_name: z.string().optional(),
  author_email: z.string().email().optional().or(z.literal('')),
  vote_count: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 0
      const num = parseInt(val, 10)
      return isNaN(num) || num < 0 ? 0 : num
    }),
  created_at: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return new Date()
      const date = new Date(val)
      return isNaN(date.getTime()) ? new Date() : date
    }),
})

interface ProcessedRow {
  title: string
  content: string
  boardId: BoardId
  statusId: StatusId | null
  status: 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed'
  authorName: string | null
  authorEmail: string | null
  voteCount: number
  createdAt: Date
  tagNames: string[]
  principalId: PrincipalId
}

/**
 * Result from processing a single batch of rows.
 */
export interface BatchResult {
  imported: number
  skipped: number
  errors: ImportRowError[]
  createdTags: string[]
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
    throw new Error(`CSV parsing failed: ${parseResult.errors[0].message}`)
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
 * creating tags and posts in the database.
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
  fallbackPrincipalId: PrincipalId
): Promise<BatchResult> {
  const result: BatchResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    createdTags: [],
  }

  // Fetch initial data outside of any transaction (neon-http compatible)
  // Get default status for the organization
  const defaultStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.isDefault, true),
  })

  // Get all existing statuses for lookup
  const existingStatuses = await db.query.postStatuses.findMany()
  const statusMap = new Map(existingStatuses.map((s) => [s.slug, s]))

  // Get all existing tags for lookup (we only need id for junction records)
  const existingTags = await db.query.tags.findMany()
  const tagMap = new Map<string, { id: TagId }>(
    existingTags.map((t) => [t.name.toLowerCase(), { id: t.id as TagId }])
  )

  // Collect all unique tag names that need to be created
  const tagsToCreate = new Set<string>()

  // Validate and prepare rows
  const validRows: { row: ProcessedRow; index: number }[] = []

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = startIndex + i + 1 // 1-indexed, excluding header
    const rawRow = rows[i]

    // Validate row
    const parseResult = csvRowSchema.safeParse(rawRow)
    if (!parseResult.success) {
      result.errors.push({
        row: rowIndex,
        message: parseResult.error.issues[0].message,
        field: parseResult.error.issues[0].path[0] as string,
      })
      result.skipped++
      continue
    }

    const row = parseResult.data

    // Resolve status
    let statusId: StatusId | null = (defaultStatus?.id ?? null) as StatusId | null
    let legacyStatus: 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed' =
      'open'

    if (row.status) {
      const status = statusMap.get(row.status.toLowerCase())
      if (status) {
        statusId = status.id as StatusId
        // Map to legacy status based on category
        if (status.category === 'complete') legacyStatus = 'complete'
        else if (status.category === 'closed') legacyStatus = 'closed'
        else if (status.slug === 'planned') legacyStatus = 'planned'
        else if (status.slug === 'in-progress' || status.slug === 'in_progress')
          legacyStatus = 'in_progress'
        else if (status.slug === 'under-review' || status.slug === 'under_review')
          legacyStatus = 'under_review'
      }
    }

    // Parse tags (limit to MAX_TAGS_PER_POST)
    const tagNames = row.tags
      ? row.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0 && t.length <= 50)
          .slice(0, MAX_TAGS_PER_POST)
      : []

    // Check for new tags
    for (const tagName of tagNames) {
      if (!tagMap.has(tagName.toLowerCase())) {
        tagsToCreate.add(tagName)
      }
    }

    // Resolve author email to a principalId (creates user+principal if needed)
    const principalId = await userResolver.resolve(
      row.author_email || null,
      row.author_name || null,
      fallbackPrincipalId
    )

    validRows.push({
      row: {
        title: row.title,
        content: row.content,
        boardId: defaultBoardId, // Always use the specified board
        statusId,
        status: legacyStatus,
        authorName: row.author_name || null,
        authorEmail: row.author_email || null,
        voteCount: row.vote_count,
        createdAt: row.created_at,
        tagNames,
        principalId,
      },
      index: rowIndex,
    })
  }

  // Pre-generate IDs for all new tags (neon-http compatible approach)
  const tagsToCreateArray = Array.from(tagsToCreate)
  const newTagIds = tagsToCreateArray.map(() => createId('tag'))

  // Build tag map with pre-generated IDs for new tags
  const newTagsWithIds = tagsToCreateArray.map((name, index) => ({
    id: newTagIds[index],
    name,
    color: '#6b7280', // Default gray color
  }))

  // Add pre-generated tag IDs to the tag map before inserting
  for (const newTag of newTagsWithIds) {
    tagMap.set(newTag.name.toLowerCase(), { id: newTag.id })
  }

  // Pre-generate IDs for all posts
  const postIds = validRows.map(() => createId('post'))

  // Flush any pending user+member creations before inserting posts
  await userResolver.flushPendingCreates()

  // Build all post data with pre-generated IDs
  const postsToInsert = validRows.map(({ row }, index) => ({
    id: postIds[index],
    boardId: row.boardId,
    title: row.title,
    content: row.content,
    statusId: row.statusId,
    principalId: row.principalId,
    voteCount: row.voteCount,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
  }))

  // Build all post-tag junction records (we now know all IDs upfront)
  const postTagsToInsert: { postId: PostId; tagId: TagId }[] = []

  for (let i = 0; i < validRows.length; i++) {
    const { row } = validRows[i]
    const postId = postIds[i]

    for (const tagName of row.tagNames) {
      const tag = tagMap.get(tagName.toLowerCase())
      if (tag) {
        postTagsToInsert.push({ postId, tagId: tag.id })
      }
    }
  }

  // Execute sequential inserts (no interactive transaction needed)
  // Insert new tags first
  if (newTagsWithIds.length > 0) {
    await db.insert(tags).values(newTagsWithIds)
    result.createdTags = tagsToCreateArray
  }

  // Insert posts
  if (postsToInsert.length > 0) {
    await db.insert(posts).values(postsToInsert)
    result.imported = validRows.length
  }

  // Insert post-tag relationships
  if (postTagsToInsert.length > 0) {
    await db.insert(postTags).values(postTagsToInsert).onConflictDoNothing()
  }

  return result
}

/**
 * Merge batch results into cumulative results.
 */
export function mergeResults(current: ImportResult, batch: BatchResult): ImportResult {
  return {
    imported: current.imported + batch.imported,
    skipped: current.skipped + batch.skipped,
    errors: [...current.errors, ...batch.errors].slice(0, MAX_ERRORS),
    createdTags: [...new Set([...current.createdTags, ...batch.createdTags])],
  }
}

/**
 * Process an entire CSV import.
 */
export async function processImport(data: ImportInput): Promise<ImportResult> {
  const validation = validateImportInput(data)
  if (!validation.success) {
    throw new Error(`Invalid import data: ${validation.error}`)
  }

  const rows = parseCSV(data.csvContent)
  let result: ImportResult = { imported: 0, skipped: 0, errors: [], createdTags: [] }

  // Single UserResolver instance shared across all batches (caches email->principalId lookups)
  const userResolver = new ImportUserResolver()

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const batchResult = await processBatch(
      batch,
      data.boardId,
      i,
      userResolver,
      data.initiatedByPrincipalId
    )
    result = mergeResults(result, batchResult)
  }

  return result
}
