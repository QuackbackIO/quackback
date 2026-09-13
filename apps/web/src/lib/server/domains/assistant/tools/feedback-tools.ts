import { withGateEnvelope } from '../tool-output'
import { can } from '@/lib/server/policy/authorize'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'
import {
  db,
  boards,
  posts,
  postTags,
  postTagAssignments,
  postStatuses,
  eq,
  and,
  isNull,
  gte,
  sql,
} from '@/lib/server/db'
import { listInboxPosts } from '@/lib/server/domains/posts/post.inbox'
import { getBaseUrl } from '@/lib/server/config'
import type { AssistantToolContext } from '../assistant.toolspec'
import { RETRIEVED_CONTENT_NOTE } from '../injection-guard'
// Zod 4.5+ `z.iso.datetime()` requires seconds, but LLMs frequently emit
// minute-precision datetimes (e.g. `2020-01-01T06:15Z`). Accept those too —
// but validate them as real calendar dates: unlike `new Date()`, which rolls
// `2026-02-30` over to March 2, this rejects it, matching the strictness the
// ISO validator applies to second-precision inputs. Deliberately a plain
// string schema (no transform), so the tool-call JSON schema is unchanged.
const isoDatetime = z.iso.datetime()
// Groups: 1 year, 2 month, 3 day, 4 hour, 5 minute, 6 full zone,
// 7 zone sign, 8 zone hours, 9 zone minutes. The zone is parsed here —
// not re-parsed downstream — so every allowed spelling is range-checked.
const MINUTE_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(Z|([+-])(\d{2}):?(\d{2}))?$/
function isValidMinutePrecision(s: string): boolean {
  const match = MINUTE_DATETIME_RE.exec(s)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return false
  // Day 0 of month+1 is the last day of month — rejects Feb 30 etc.,
  // which `new Date()` would otherwise roll into the next month.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day < 1 || day > daysInMonth) return false
  // Real UTC offsets run from -12:00 to +14:00, but `Date.parse` accepts
  // out-of-range offsets as genuine instants — so check explicitly.
  if (match[6] && match[6] !== 'Z') {
    const sign = match[7] === '-' ? -1 : 1
    const offsetMinutes = Number(match[9])
    if (offsetMinutes > 59) return false
    const totalMinutes = sign * (Number(match[8]) * 60 + offsetMinutes)
    if (totalMinutes < -12 * 60 || totalMinutes > 14 * 60) return false
  }
  return true
}
export const flexibleDatetime = z
  .string()
  .refine((s) => isoDatetime.safeParse(s).success || isValidMinutePrecision(s), 'Invalid datetime')
const listInput = z.object({
  query: z.string().max(300).optional(),
  boardSlug: z.string().max(100).optional(),
  statusSlug: z.string().max(100).optional(),
  tagSlug: z.string().max(100).optional(),
  since: flexibleDatetime.optional(),
  sort: z.enum(['votes', 'recent']).default('votes'),
  limit: z.number().int().min(1).max(20).default(10),
})
export const listFeedbackTool = toolDefinition({
  name: 'list_feedback',
  description:
    'List feedback with filters, ordered by votes or recency. Returns citable post IDs. tagSlug matches the tag name with spaces replaced by hyphens.',
  inputSchema: listInput,
  outputSchema: withGateEnvelope(
    z.object({
      items: z.array(
        z.object({
          id: z.string().describe('Citation id — put this in the citations array.'),
          title: z
            .string()
            .describe('Exact post title. Copy verbatim, including any parenthetical in the title.'),
          url: z.string().describe('Canonical link. Use as the markdown link target.'),
          votes: z
            .number()
            .describe('Vote count. Separate from the title; do not fold into the title.'),
          status: z.string().nullable(),
          board: z.string(),
          created: z.string(),
          summary: z.string(),
        })
      ),
      note: z.string().optional(),
    })
  ),
})
export async function executeListFeedback(
  input: z.input<typeof listInput>,
  ctx: AssistantToolContext
) {
  if (
    ctx.audience !== 'team' ||
    !ctx.knowledge.sources.has('post') ||
    !can(ctx.actor, PERMISSIONS.POST_VIEW_PRIVATE)
  )
    return { items: [] }
  const args = listInput.parse(input)
  const board = args.boardSlug
    ? await db.query.boards.findFirst({ where: eq(boards.slug, args.boardSlug) })
    : null
  if (args.boardSlug && !board) return { items: [] }
  const tag = args.tagSlug
    ? await db.query.postTags.findFirst({
        where: and(
          sql`lower(replace(${postTags.name}, ' ', '-')) = ${args.tagSlug.toLowerCase()}`,
          isNull(postTags.deletedAt)
        ),
      })
    : null
  if (args.tagSlug && !tag) return { items: [] }
  const result = await listInboxPosts({
    search: args.query,
    boardIds: board ? [board.id] : undefined,
    tagIds: tag ? [tag.id] : undefined,
    statusSlugs: args.statusSlug ? [args.statusSlug] : undefined,
    dateFrom: args.since ? new Date(args.since) : undefined,
    sort: args.sort === 'votes' ? 'votes' : 'newest',
    limit: args.limit,
  })
  const statuses = await db.query.postStatuses.findMany()
  const names = new Map(statuses.map((status) => [status.id, status.name]))
  const items = result.items.map((post) => {
    const url = `${getBaseUrl()}/b/${encodeURIComponent(post.board.slug)}/posts/${post.id}`
    ctx.ledger.sources.set(post.id, { type: 'post', id: post.id, title: post.title, url })
    return {
      id: post.id,
      title: post.title,
      url,
      votes: post.voteCount,
      status: post.statusId ? (names.get(post.statusId) ?? null) : null,
      board: post.board.name,
      created: post.createdAt.toISOString(),
      summary: post.summaryJson?.summary?.slice(0, 300) ?? '',
    }
  })
  return items.length > 0 ? { items, note: RETRIEVED_CONTENT_NOTE } : { items }
}
const statsInput = z.object({
  since: flexibleDatetime.optional(),
  groupBy: z.enum(['status', 'board', 'tag']),
})
export const feedbackStatsTool = toolDefinition({
  name: 'feedback_stats',
  description:
    'Count feedback and votes grouped by board, status, or tag. Includes a representative citable post per group. Tag groups may overlap.',
  inputSchema: statsInput,
  outputSchema: withGateEnvelope(
    z.object({
      groups: z.array(
        z.object({
          name: z.string(),
          count: z.number(),
          votes: z.number(),
          postId: z.string(),
          url: z.string(),
        })
      ),
      note: z.string().optional(),
    })
  ),
})
export async function executeFeedbackStats(
  args: z.infer<typeof statsInput>,
  ctx: AssistantToolContext
) {
  if (
    ctx.audience !== 'team' ||
    !ctx.knowledge.sources.has('post') ||
    !can(ctx.actor, PERMISSIONS.POST_VIEW_PRIVATE)
  )
    return { groups: [] }
  const group =
    args.groupBy === 'board'
      ? boards.name
      : args.groupBy === 'status'
        ? postStatuses.name
        : postTags.name
  const groupId =
    args.groupBy === 'board' ? boards.id : args.groupBy === 'status' ? postStatuses.id : postTags.id
  const rows = await db
    .select({
      name: group,
      count: sql<number>`count(distinct ${posts.id})::int`,
      votes: sql<number>`coalesce(sum(${posts.voteCount}), 0)::int`,
      postId: sql<string>`min(${posts.id}::text)`,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .leftJoin(
      postTagAssignments,
      args.groupBy === 'tag' ? eq(postTagAssignments.postId, posts.id) : sql`false`
    )
    .leftJoin(postTags, and(eq(postTags.id, postTagAssignments.tagId), isNull(postTags.deletedAt)))
    .where(
      and(
        isNull(posts.deletedAt),
        isNull(boards.deletedAt),
        isNull(posts.canonicalPostId),
        args.since ? gte(posts.createdAt, new Date(args.since)) : undefined
      )
    )
    .groupBy(groupId, group)
  // Post IDs from raw aggregates are UUIDs; preserve the app's TypeID contract.
  const { fromUuid } = await import('@quackback/ids')
  const groups = rows.map((row) => {
    const id = fromUuid('post', row.postId)
    const url = `${getBaseUrl()}/admin/feedback?post=${id}`
    const name = row.name ?? 'Unassigned'
    ctx.ledger.sources.set(id, { type: 'post', id, title: `${name} feedback`, url })
    return {
      name,
      count: row.count,
      votes: row.votes,
      postId: id,
      url,
    }
  })
  return groups.length > 0 ? { groups, note: RETRIEVED_CONTENT_NOTE } : { groups }
}
