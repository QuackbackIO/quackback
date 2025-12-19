/**
 * Shared import processing logic.
 *
 * This module contains the business logic for CSV import processing,
 * extracted to be used by both BullMQ workers and Cloudflare Workflows.
 */

import Papa from 'papaparse'
import { z } from 'zod'
import { withTenantContext, posts, tags, postTags, postStatuses, eq, and } from '@quackback/db'
import {
  workspaceIdSchema,
  boardIdSchema,
  type WorkspaceId,
  type BoardId,
  type PostId,
  type TagId,
  type StatusId,
} from '@quackback/ids'
import type { ImportJobData, ImportJobResult, ImportRowError } from '../types'

// Constants
export const MAX_ERRORS = 100
export const MAX_TAGS_PER_POST = 20
export const BATCH_SIZE = 100

/**
 * Job data validation schema
 */
export const jobDataSchema = z.object({
  workspaceId: workspaceIdSchema,
  boardId: boardIdSchema,
  csvContent: z.string().min(1, 'CSV content is required'),
  totalRows: z.number().int().positive(),
})

/**
 * CSV row validation schema
 */
export const csvRowSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 characters or less'),
  content: z
    .string()
    .min(1, 'Content is required')
    .max(10000, 'Content must be 10000 characters or less'),
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
 * Validate import job data.
 */
export function validateJobData(
  data: ImportJobData
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
 */
export async function processBatch(
  rows: Record<string, string>[],
  workspaceId: WorkspaceId,
  defaultBoardId: BoardId,
  startIndex: number
): Promise<BatchResult> {
  const result: BatchResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    createdTags: [],
  }

  // Use tenant context for RLS
  await withTenantContext(workspaceId, async (tx) => {
    // Get default status for the organization
    const defaultStatus = await tx.query.postStatuses.findFirst({
      where: and(eq(postStatuses.workspaceId, workspaceId), eq(postStatuses.isDefault, true)),
    })

    // Get all existing statuses for lookup
    const existingStatuses = await tx.query.postStatuses.findMany({
      where: eq(postStatuses.workspaceId, workspaceId),
    })
    const statusMap = new Map(existingStatuses.map((s) => [s.slug, s]))

    // Get all existing tags for lookup
    const existingTags = await tx.query.tags.findMany({
      where: eq(tags.workspaceId, workspaceId),
    })
    const tagMap = new Map(existingTags.map((t) => [t.name.toLowerCase(), t]))

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
      let legacyStatus:
        | 'open'
        | 'under_review'
        | 'planned'
        | 'in_progress'
        | 'complete'
        | 'closed' = 'open'

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
        },
        index: rowIndex,
      })
    }

    // Create missing tags
    if (tagsToCreate.size > 0) {
      const newTags = Array.from(tagsToCreate).map((name) => ({
        workspaceId,
        name,
        color: '#6b7280', // Default gray color
      }))

      const insertedTags = await tx.insert(tags).values(newTags).returning()

      // Update tag map with new tags
      for (const tag of insertedTags) {
        tagMap.set(tag.name.toLowerCase(), tag)
      }

      result.createdTags = Array.from(tagsToCreate)
    }

    // Insert posts
    if (validRows.length > 0) {
      const postsToInsert = validRows.map(({ row }) => ({
        workspaceId,
        boardId: row.boardId,
        title: row.title,
        content: row.content,
        statusId: row.statusId,
        status: row.status,
        authorName: row.authorName,
        authorEmail: row.authorEmail,
        voteCount: row.voteCount,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      }))

      const insertedPosts = await tx.insert(posts).values(postsToInsert).returning({ id: posts.id })

      // Insert post tags
      const postTagsToInsert: { postId: PostId; tagId: TagId }[] = []

      for (let i = 0; i < validRows.length; i++) {
        const { row } = validRows[i]
        const postId = insertedPosts[i].id as PostId

        for (const tagName of row.tagNames) {
          const tag = tagMap.get(tagName.toLowerCase())
          if (tag) {
            postTagsToInsert.push({ postId, tagId: tag.id as TagId })
          }
        }
      }

      if (postTagsToInsert.length > 0) {
        await tx.insert(postTags).values(postTagsToInsert).onConflictDoNothing()
      }

      result.imported = validRows.length
    }
  })

  return result
}

/**
 * Merge batch results into cumulative results.
 */
export function mergeResults(current: ImportJobResult, batch: BatchResult): ImportJobResult {
  return {
    imported: current.imported + batch.imported,
    skipped: current.skipped + batch.skipped,
    errors: [...current.errors, ...batch.errors].slice(0, MAX_ERRORS),
    createdTags: [...new Set([...current.createdTags, ...batch.createdTags])],
  }
}

/**
 * Process an entire import job (for use in workflows).
 *
 * Note: BullMQ workers should use processBatch directly for progress tracking.
 */
export async function processImport(data: ImportJobData): Promise<ImportJobResult> {
  const validation = validateJobData(data)
  if (!validation.success) {
    throw new Error(`Invalid job data: ${validation.error}`)
  }

  const rows = parseCSV(data.csvContent)
  let result: ImportJobResult = { imported: 0, skipped: 0, errors: [], createdTags: [] }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const batchResult = await processBatch(batch, data.workspaceId, data.boardId, i)
    result = mergeResults(result, batchResult)
  }

  return result
}
