/**
 * Row validation/resolution shared by the dry-run preview
 * (`import-preview.ts`) and the commit path (`import-service.ts`): CSV row
 * schema, status/board/tag lookups, and author resolution. Read-only —
 * nothing in this module writes to the database, which is what makes the
 * dry run safe.
 *
 * Unknown status/board values are collected (not written) into the
 * `statusesToCreate`/`boardsToCreate` maps the caller passes in — the commit
 * path creates them, the dry run just reports them. Slugify is the identity:
 * "Feature Requests" and "feature-requests" are the same board.
 */
import { z } from 'zod'
import { db, postStatuses, eq } from '@/lib/server/db'
import { slugify } from '@/lib/shared/utils'
import type { BoardId, PrincipalId, PostTagId, PostStatusId } from '@quackback/ids'
import type { ImportRowError } from './types'
import type { ImportUserResolver } from './user-resolver'

export const MAX_TAGS_PER_POST = 20
export const BATCH_SIZE = 100
/** integration_type value on post_external_links for rows carrying a source_id column. */
export const IMPORT_LINK_TYPE = 'import'

/**
 * Recognized falsy spellings for the email_verified column. Import-created
 * users default to VERIFIED — the shell has no credential accounts, so the
 * real person must be able to claim it via SSO on first sign-in. An explicit
 * false/0/no opts a dubious address out of that trust.
 */
const CSV_FALSY = new Set(['false', '0', 'no'])

/** Parse the email_verified cell: false/0/no (case-insensitive) opt out; absent or anything else defaults to verified. */
export function parseCsvEmailVerified(value: string | undefined): boolean {
  if (!value || !value.trim()) return true
  return !CSV_FALSY.has(value.trim().toLowerCase())
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
  // Whether the author's email is verified when this row CREATES the user
  // (default true — claimable shell). Existing users are never flipped.
  email_verified: z
    .string()
    .optional()
    .transform((val) => parseCsvEmailVerified(val)),
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
  /** Slug of a board this row needs created (null when it matched an existing board). */
  pendingBoardSlug: string | null
  /** Slug of a status this row needs created (null when it matched an existing status). */
  pendingStatusSlug: string | null
}

export interface ResolvedRow {
  row: ProcessedRow
  index: number
}

/** Read-only lookups shared by every row in a batch. */
export interface RowContext {
  defaultStatusId: PostStatusId | null
  /** Statuses by slug. */
  statusMap: Map<string, { id: PostStatusId; category: string; slug: string; name: string }>
  /** Lowercase status name -> slug, so "In Progress" matches the in_progress slug. */
  statusNames: Map<string, string>
  /** Position for the next auto-created 'active' status (max existing + 1). */
  nextActiveStatusPosition: number
  tagMap: Map<string, { id: PostTagId }>
  /** Boards by slug. */
  boardMap: Map<string, { id: BoardId; slug: string }>
  /** Lowercase board name -> slug. */
  boardNames: Map<string, string>
}

export async function loadRowContext(): Promise<RowContext> {
  const defaultStatus = await db.query.postStatuses.findFirst({
    where: eq(postStatuses.isDefault, true),
  })

  const existingStatuses = await db.query.postStatuses.findMany()
  const statusMap = new Map(existingStatuses.map((s) => [s.slug, s]))
  const statusNames = new Map(existingStatuses.map((s) => [s.name.toLowerCase(), s.slug]))
  const nextActiveStatusPosition =
    existingStatuses.reduce(
      (max, s) => (s.category === 'active' ? Math.max(max, s.position) : max),
      -1
    ) + 1

  const existingTags = await db.query.postTags.findMany()
  const tagMap = new Map<string, { id: PostTagId }>(
    existingTags.map((t) => [t.name.toLowerCase(), { id: t.id as PostTagId }])
  )

  const existingBoards = await db.query.boards.findMany()
  const boardMap = new Map(
    existingBoards.map((b) => [b.slug, { id: b.id as BoardId, slug: b.slug }])
  )
  const boardNames = new Map(existingBoards.map((b) => [b.name.toLowerCase(), b.slug]))

  return {
    defaultStatusId: (defaultStatus?.id ?? null) as PostStatusId | null,
    statusMap,
    statusNames,
    nextActiveStatusPosition,
    tagMap,
    boardMap,
    boardNames,
  }
}

/**
 * Resolve a CSV status/board cell to an existing entry: exact slug, then
 * slugified cell ("Feature Requests" -> feature-requests), then
 * case-insensitive name. Returns the canonical slug on a hit, null otherwise.
 */
export function matchExistingSlug(
  value: string,
  bySlug: ReadonlyMap<string, unknown>,
  byName: ReadonlyMap<string, string>
): string | null {
  const lowered = value.trim().toLowerCase()
  if (bySlug.has(lowered)) return lowered
  const slugged = slugify(value)
  if (slugged && bySlug.has(slugged)) return slugged
  return byName.get(lowered) ?? null
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
 * IDs for genuinely new tag names across the whole batch; `statusesToCreate`
 * and `boardsToCreate` (slug -> display name) collect unknown values the same
 * way — the commit path creates them, the dry run reports them.
 */
export async function resolveRows(
  rows: Record<string, string>[],
  defaultBoardId: BoardId,
  startIndex: number,
  userResolver: ImportUserResolver,
  fallbackPrincipalId: PrincipalId,
  ctx: RowContext,
  tagsToCreate: Set<string>,
  statusesToCreate: Map<string, string>,
  boardsToCreate: Map<string, string>
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

    // Status: match an existing one by slug/slugified/name; otherwise queue
    // the value for auto-creation (commit path) and label the row with the
    // raw text so the preview shows what will be created.
    let statusId: PostStatusId | null = ctx.defaultStatusId
    let statusLabel: string | null = null
    let status: { id: PostStatusId; category: string; slug: string; name: string } | undefined
    let pendingStatusSlug: string | null = null
    if (row.status) {
      const matchedSlug = matchExistingSlug(row.status, ctx.statusMap, ctx.statusNames)
      if (matchedSlug) {
        status = ctx.statusMap.get(matchedSlug)
        statusId = status!.id
        statusLabel = status!.name
      } else {
        const slug = slugify(row.status)
        if (slug) {
          pendingStatusSlug = slug
          statusId = null
          statusLabel = row.status.trim()
          if (!statusesToCreate.has(slug)) statusesToCreate.set(slug, row.status.trim())
        }
      }
    }

    // Per-row board routing: the "board" column matches an existing board by
    // slug/slugified/name; unknown values are queued for auto-creation. Rows
    // without a board cell land on the default board.
    let boardId = defaultBoardId
    let boardSlug: string | null = null
    let pendingBoardSlug: string | null = null
    if (row.board) {
      const matchedSlug = matchExistingSlug(row.board, ctx.boardMap, ctx.boardNames)
      if (matchedSlug) {
        const board = ctx.boardMap.get(matchedSlug)!
        boardId = board.id
        boardSlug = board.slug
      } else {
        const slug = slugify(row.board)
        if (slug) {
          pendingBoardSlug = slug
          boardSlug = slug
          if (!boardsToCreate.has(slug)) boardsToCreate.set(slug, row.board.trim())
        }
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
        pendingBoardSlug,
        pendingStatusSlug,
      },
      index: rowIndex,
    })
  }

  return { validRows, errors, skipped }
}
