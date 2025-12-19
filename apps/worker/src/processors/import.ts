import { Job } from 'bullmq'
import Papa from 'papaparse'
import { z } from 'zod'
import { withTenantContext, posts, tags, postTags, postStatuses, eq, and } from '@quackback/db'
import type { ImportJobData, ImportJobResult, ImportRowError } from '@quackback/jobs'
import { workspaceIdSchema, boardIdSchema, type WorkspaceId, type BoardId } from '@quackback/ids'

// Constants
const MAX_ERRORS = 100
const MAX_TAGS_PER_POST = 20

/**
 * Job data validation schema
 */
const jobDataSchema = z.object({
  workspaceId: workspaceIdSchema,
  boardId: boardIdSchema,
  csvContent: z.string().min(1, 'CSV content is required'),
  totalRows: z.number().int().positive(),
})

/**
 * CSV row validation schema
 */
const csvRowSchema = z.object({
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
  statusId: string | null
  status: 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed'
  authorName: string | null
  authorEmail: string | null
  voteCount: number
  createdAt: Date
  tagNames: string[]
}

interface BatchResult {
  imported: number
  skipped: number
  errors: ImportRowError[]
  createdTags: string[]
}

/**
 * Process an import job
 */
export async function processImportJob(job: Job<ImportJobData>): Promise<ImportJobResult> {
  // Validate job data
  const validated = jobDataSchema.safeParse(job.data)
  if (!validated.success) {
    throw new Error(`Invalid job data: ${validated.error.issues[0].message}`)
  }

  const { workspaceId, boardId, csvContent, totalRows } = validated.data

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

  const rows = parseResult.data
  const batchSize = 100
  let imported = 0
  let skipped = 0
  const errors: ImportRowError[] = []
  const createdTagsSet = new Set<string>()

  // Process in batches
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const batchResult = await processBatch(batch, workspaceId, boardId, i)

    imported += batchResult.imported
    skipped += batchResult.skipped

    // Limit error array to prevent OOM
    if (errors.length < MAX_ERRORS) {
      const remaining = MAX_ERRORS - errors.length
      errors.push(...batchResult.errors.slice(0, remaining))
    }

    batchResult.createdTags.forEach((tag) => createdTagsSet.add(tag))

    // Report progress
    await job.updateProgress({
      processed: Math.min(i + batchSize, rows.length),
      total: totalRows,
    })
  }

  return {
    imported,
    skipped,
    errors,
    createdTags: Array.from(createdTagsSet),
  }
}

/**
 * Process a batch of rows
 */
async function processBatch(
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
    // Get default status for the workspace
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
      let statusId: string | null = defaultStatus?.id ?? null
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
          statusId = status.id
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
      const postTagsToInsert: { postId: string; tagId: string }[] = []

      for (let i = 0; i < validRows.length; i++) {
        const { row } = validRows[i]
        const postId = insertedPosts[i].id

        for (const tagName of row.tagNames) {
          const tag = tagMap.get(tagName.toLowerCase())
          if (tag) {
            postTagsToInsert.push({ postId, tagId: tag.id })
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
