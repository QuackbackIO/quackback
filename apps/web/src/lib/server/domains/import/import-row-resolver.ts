/**
 * Row validation/resolution shared by the dry-run preview
 * (`import-preview.ts`) and the commit path (`import-service.ts`): CSV row
 * schema, status/board/tag lookups, and author resolution. Read-only —
 * nothing in this module writes to the database, which is what makes the
 * dry run safe.
 */
import { z } from 'zod'
import { db, postStatuses, eq } from '@/lib/server/db'
import type { BoardId, PrincipalId, PostTagId, PostStatusId } from '@quackback/ids'
import type { ImportRowError } from './types'
import type { ImportUserResolver } from './user-resolver'

export const MAX_TAGS_PER_POST = 20
export const BATCH_SIZE = 100
/** integration_type value on post_external_links for rows carrying a source_id column. */
export const IMPORT_LINK_TYPE = 'import'

/**
 * Recognized truthy spellings for the email_verified column. Anything else
 * (empty, absent, "no", "0", garbage) reads as false — asserting a verified
 * email grants portal access, so the parse errs on the side of NOT trusted.
 */
const CSV_TRUTHY = new Set(['true', '1', 'yes'])

/** Parse a CSV boolean cell: true/1/yes (case-insensitive), default false. */
export function parseCsvBoolean(value: string | undefined): boolean {
  if (!value) return false
  return CSV_TRUTHY.has(value.trim().toLowerCase())
}

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
  // Asserts the author's email as verified when this row CREATES the user.
  // Existing users are never flipped by an import row.
  email_verified: z
    .string()
    .optional()
    .transform((val) => parseCsvBoolean(val)),
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
  // Optional stable identifier from the source system (§I2). When present,
  // re-importing the same row updates the post it previously created instead
  // of creating a duplicate.
  source_id: z.string().max(200).optional(),
})

export interface ProcessedRow {
  title: string
  content: string
  boardId: BoardId
  boardSlug: string | null
  statusId: PostStatusId | null
  status: 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed'
  statusLabel: string | null
  authorName: string | null
  authorEmail: string | null
  isNewAuthor: boolean
  voteCount: number
  createdAt: Date
  tagNames: string[]
  principalId: PrincipalId
  sourceId: string | null
}

export interface ResolvedRow {
  row: ProcessedRow
  index: number
}

/** Read-only lookups shared by every row in a batch. */
export interface RowContext {
  defaultStatusId: PostStatusId | null
  statusMap: Map<string, { id: PostStatusId; category: string; slug: string; name: string }>
  tagMap: Map<string, { id: PostTagId }>
  boardMap: Map<string, { id: BoardId; slug: string }>
}

export async function loadRowContext(): Promise<RowContext> {
  const defaultStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.isDefault, true),
  })

  const existingStatuses = await db.query.postStatuses.findMany()
  const statusMap = new Map(existingStatuses.map((s) => [s.slug, s]))

  const existingTags = await db.query.postTags.findMany()
  const tagMap = new Map<string, { id: PostTagId }>(
    existingTags.map((t) => [t.name.toLowerCase(), { id: t.id as PostTagId }])
  )

  const existingBoards = await db.query.boards.findMany()
  const boardMap = new Map(
    existingBoards.map((b) => [b.slug, { id: b.id as BoardId, slug: b.slug }])
  )

  return {
    defaultStatusId: (defaultStatus?.id ?? null) as PostStatusId | null,
    statusMap,
    tagMap,
    boardMap,
  }
}

function legacyStatusFor(status?: {
  category: string
  slug: string
}): 'open' | 'under_review' | 'planned' | 'in_progress' | 'complete' | 'closed' {
  if (!status) return 'open'
  if (status.category === 'complete') return 'complete'
  if (status.category === 'closed') return 'closed'
  if (status.slug === 'planned') return 'planned'
  if (status.slug === 'in-progress' || status.slug === 'in_progress') return 'in_progress'
  if (status.slug === 'under-review' || status.slug === 'under_review') return 'under_review'
  return 'open'
}

/**
 * Validate and resolve a batch of raw CSV rows: status/board lookups, tag
 * parsing, and author resolution. Read-only against posts/tags — safe to
 * call for a dry run. `tagsToCreate` is mutated so callers can pre-generate
 * IDs for genuinely new tag names across the whole batch.
 */
export async function resolveRows(
  rows: Record<string, string>[],
  defaultBoardId: BoardId,
  startIndex: number,
  userResolver: ImportUserResolver,
  fallbackPrincipalId: PrincipalId,
  ctx: RowContext,
  tagsToCreate: Set<string>
): Promise<{ validRows: ResolvedRow[]; errors: ImportRowError[]; skipped: number }> {
  const validRows: ResolvedRow[] = []
  const errors: ImportRowError[] = []
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = startIndex + i + 1 // 1-indexed, excluding header
    const rawRow = rows[i]

    const parseResult = csvRowSchema.safeParse(rawRow)
    if (!parseResult.success) {
      errors.push({
        row: rowIndex,
        message: parseResult.error.issues[0].message,
        field: parseResult.error.issues[0].path[0] as string,
      })
      skipped++
      continue
    }

    const row = parseResult.data

    let statusId: PostStatusId | null = ctx.defaultStatusId
    let statusLabel: string | null = null
    const status = row.status ? ctx.statusMap.get(row.status.toLowerCase()) : undefined
    if (status) {
      statusId = status.id
      statusLabel = status.name
    }

    // Per-row board routing: the mapped "board" column carries a board slug
    // (the wizard's board-mapping step resolves free-text values to slugs
    // before upload). Falls back to the default board when absent or unknown.
    let boardId = defaultBoardId
    let boardSlug: string | null = null
    if (row.board) {
      const board = ctx.boardMap.get(row.board.toLowerCase())
      if (board) {
        boardId = board.id
        boardSlug = board.slug
      }
    }

    const tagNames = row.tags
      ? row.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0 && t.length <= 50)
          .slice(0, MAX_TAGS_PER_POST)
      : []

    for (const tagName of tagNames) {
      if (!ctx.tagMap.has(tagName.toLowerCase())) {
        tagsToCreate.add(tagName)
      }
    }

    // A row's author is "new" when this call is the one that queued it for
    // creation (pendingCount grows by one). Comparing before/after avoids
    // false positives on later rows once the queue is non-empty.
    const pendingBefore = userResolver.pendingCount
    const principalId = await userResolver.resolve(
      row.author_email || null,
      row.author_name || null,
      fallbackPrincipalId,
      row.email_verified
    )
    const isNewAuthor = userResolver.pendingCount > pendingBefore

    validRows.push({
      row: {
        title: row.title,
        content: row.content,
        boardId,
        boardSlug,
        statusId,
        status: legacyStatusFor(status),
        statusLabel,
        authorName: row.author_name || null,
        authorEmail: row.author_email || null,
        isNewAuthor,
        voteCount: row.vote_count,
        createdAt: row.created_at,
        tagNames,
        principalId,
        sourceId: row.source_id || null,
      },
      index: rowIndex,
    })
  }

  return { validRows, errors, skipped }
}
