import {
  db,
  posts,
  boards,
  helpCenterArticles,
  helpCenterCategories,
  changelogEntries,
  conversations,
  conversationSummaries,
  tickets,
  ticketSummaries,
  and,
  eq,
  isNotNull,
  isNull,
  sql,
} from '@/lib/server/db'
import { can } from '@/lib/server/policy/authorize'
import { postViewFilter } from '@/lib/server/policy/posts'
import { conversationFilter } from '@/lib/server/policy/conversations'
import { ticketFilter } from '@/lib/server/policy/tickets'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types/settings'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { helpCenterVisibilityConditions } from '@/lib/server/domains/help-center/help-center-search.service'
import {
  searchExcerpt,
  type AskEntityKind,
  type AskEntityResult,
} from '@/lib/shared/assistant/ask-search'

/** Dashboard-only search; customer-scoped grounding adapters remain unchanged. */
export async function searchWorkspaceSemantically(
  query: string,
  actor: Actor,
  flags: Partial<FeatureFlags>,
  options: { kind?: AskEntityKind; limit?: number; signal?: AbortSignal } = {}
): Promise<{ available: boolean; results: AskEntityResult[] }> {
  if (!actor.principalId || (actor.role !== 'admin' && actor.role !== 'member'))
    return { available: false, results: [] }
  const included = (kind: AskEntityKind) => !options.kind || options.kind === kind
  const allowed = {
    post:
      included('post') &&
      isProductEnabled(flags, 'feedback') &&
      can(actor, PERMISSIONS.POST_VIEW_PRIVATE),
    article:
      included('article') &&
      isProductEnabled(flags, 'helpCenter') &&
      can(actor, PERMISSIONS.HELP_CENTER_MANAGE),
    changelog:
      included('changelog') &&
      isProductEnabled(flags, 'changelog') &&
      (can(actor, PERMISSIONS.CHANGELOG_VIEW_DRAFT) || can(actor, PERMISSIONS.CHANGELOG_MANAGE)),
    conversation:
      included('conversation') && !!flags.supportInbox && can(actor, PERMISSIONS.CONVERSATION_VIEW),
    ticket: included('ticket') && !!flags.supportTickets && can(actor, PERMISSIONS.TICKET_VIEW),
  }
  if (!query.trim() || !Object.values(allowed).some(Boolean))
    return { available: false, results: [] }
  const embedding = await generateEmbedding(
    query.trim().slice(0, 200),
    { pipelineStep: 'workspace_search_query' },
    { signal: options.signal }
  )
  if (!embedding || options.signal?.aborted) return { available: false, results: [] }
  const vector = `[${embedding.join(',')}]`
  const model = getEmbeddingModel()
  const limit = Math.min(options.limit ?? 10, 50)
  const score = (column: Parameters<typeof isNotNull>[0]) =>
    sql<number>`1 - (${column} <=> ${vector}::vector)`
  const searches: Promise<AskEntityResult[]>[] = []
  const result = (
    kind: AskEntityKind,
    row: {
      id: string
      title: string | null
      content: string | null
      updatedAt: Date
      score: number
    }
  ): AskEntityResult => ({
    id: row.id,
    kind,
    title: row.title ?? 'Support conversation',
    excerpt: searchExcerpt(row.content),
    updatedAt: row.updatedAt.toISOString(),
    score: Number(row.score),
    href:
      kind === 'post'
        ? `/admin/feedback?post=${encodeURIComponent(row.id)}`
        : kind === 'article'
          ? `/admin/help-center?article=${encodeURIComponent(row.id)}`
          : kind === 'changelog'
            ? `/admin/changelog?entry=${encodeURIComponent(row.id)}`
            : `/admin/inbox?i=${encodeURIComponent(row.id)}`,
  })
  if (allowed.post)
    searches.push(
      db
        .select({
          id: posts.id,
          title: posts.title,
          content: sql<string>`left(${posts.content}, 400)`,
          updatedAt: posts.updatedAt,
          score: score(posts.embedding),
        })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .where(
          and(
            postViewFilter(actor),
            isNull(posts.deletedAt),
            isNull(boards.deletedAt),
            isNotNull(posts.embedding),
            eq(posts.embeddingModel, model!),
            sql`${score(posts.embedding)} >= 0.35`
          )
        )
        .orderBy(sql`${posts.embedding} <=> ${vector}::vector`, posts.id)
        .limit(limit)
        .then((rows) => rows.map((row) => result('post', row)))
    )
  if (allowed.article)
    searches.push(
      db
        .select({
          id: helpCenterArticles.id,
          title: helpCenterArticles.title,
          content: sql<string>`left(${helpCenterArticles.content}, 400)`,
          updatedAt: helpCenterArticles.updatedAt,
          score: score(helpCenterArticles.embedding),
        })
        .from(helpCenterArticles)
        .innerJoin(helpCenterCategories, eq(helpCenterCategories.id, helpCenterArticles.categoryId))
        .where(
          and(
            ...helpCenterVisibilityConditions('team', actor),
            isNotNull(helpCenterArticles.embedding),
            eq(helpCenterArticles.embeddingModel, model!),
            sql`${score(helpCenterArticles.embedding)} >= 0.35`
          )
        )
        .orderBy(sql`${helpCenterArticles.embedding} <=> ${vector}::vector`, helpCenterArticles.id)
        .limit(limit)
        .then((rows) => rows.map((row) => result('article', row)))
    )
  if (allowed.changelog)
    searches.push(
      db
        .select({
          id: changelogEntries.id,
          title: changelogEntries.title,
          content: sql<string>`left(${changelogEntries.content}, 400)`,
          updatedAt: changelogEntries.updatedAt,
          score: score(changelogEntries.embedding),
        })
        .from(changelogEntries)
        .where(
          and(
            isNull(changelogEntries.deletedAt),
            isNotNull(changelogEntries.embedding),
            eq(changelogEntries.embeddingModel, model!),
            sql`${score(changelogEntries.embedding)} >= 0.35`
          )
        )
        .orderBy(sql`${changelogEntries.embedding} <=> ${vector}::vector`, changelogEntries.id)
        .limit(limit)
        .then((rows) => rows.map((row) => result('changelog', row)))
    )
  if (allowed.conversation)
    searches.push(
      db
        .select({
          id: conversations.id,
          title: conversations.subject,
          content: conversationSummaries.summary,
          updatedAt: conversationSummaries.updatedAt,
          score: score(conversationSummaries.embedding),
        })
        .from(conversationSummaries)
        .innerJoin(conversations, eq(conversations.id, conversationSummaries.conversationId))
        .where(
          and(
            conversationFilter(actor),
            isNotNull(conversationSummaries.embedding),
            eq(conversationSummaries.embeddingModel, model!),
            sql`${score(conversationSummaries.embedding)} >= 0.35`
          )
        )
        .orderBy(sql`${conversationSummaries.embedding} <=> ${vector}::vector`, conversations.id)
        .limit(limit)
        .then((rows) => rows.map((row) => result('conversation', row)))
    )
  if (allowed.ticket)
    searches.push(
      db
        .select({
          id: tickets.id,
          title: tickets.title,
          content: ticketSummaries.summary,
          updatedAt: ticketSummaries.updatedAt,
          score: score(ticketSummaries.embedding),
        })
        .from(ticketSummaries)
        .innerJoin(tickets, eq(tickets.id, ticketSummaries.ticketId))
        .where(
          and(
            ticketFilter(actor),
            isNotNull(ticketSummaries.embedding),
            eq(ticketSummaries.embeddingModel, model!),
            sql`${score(ticketSummaries.embedding)} >= 0.35`
          )
        )
        .orderBy(sql`${ticketSummaries.embedding} <=> ${vector}::vector`, tickets.id)
        .limit(limit)
        .then((rows) => rows.map((row) => result('ticket', row)))
    )
  return {
    available: true,
    results: (await Promise.all(searches))
      .flat()
      .sort((a, b) => b.score! - a.score! || a.id.localeCompare(b.id)),
  }
}
