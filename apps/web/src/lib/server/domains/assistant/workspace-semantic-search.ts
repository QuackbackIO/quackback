/**
 * Matches by meaning for workspace search, merged into the full-text list
 * by ask-search.ts. One embedding request per query: the query's vector is
 * kept per workspace for a few minutes, so the next page or a type filter
 * reuses it. With no embedding provider, or when the provider fails or is
 * slow, this returns nothing and full-text results stand alone.
 *
 * Each kind applies the same visibility rule as its full-text query.
 * People, teammates and companies have no embeddings and are skipped.
 */
import type { SQL } from 'drizzle-orm'
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
  sql,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { conversationFilter } from '@/lib/server/policy/conversations'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import { logger } from '@/lib/server/logger'
import type { SearchKind, SearchResult } from '@/lib/shared/assistant/ask-search'
import {
  articleHref,
  articleSearchScope,
  changelogSearchScope,
  postSearchScope,
  titleTier,
  toSearchResult,
} from './ask-search'

const log = logger.child({ module: 'workspace-semantic-search' })

/** Below this cosine similarity a record is not a match (as in help center search). */
export const SEMANTIC_FLOOR = 0.35
const VECTOR_TTL_MS = 10 * 60_000

interface CachedVector {
  at: number
  vector: string
}

const vectors = new WorkspaceKeyedCache<CachedVector>(500)

/** The query's vector: from the cache, or from one embedding request. */
async function queryVector(
  text: string,
  model: string,
  signal?: AbortSignal
): Promise<string | null> {
  const key = `${model}\u0000${text.toLowerCase()}`
  const cached = vectors.get(key)
  if (cached && Date.now() - cached.at < VECTOR_TTL_MS) return cached.vector
  const embedding = await generateEmbedding(
    text,
    { pipelineStep: 'workspace_search_query' },
    { signal }
  )
  if (!embedding || signal?.aborted) return null
  const vector = `[${embedding.join(',')}]`
  vectors.set(key, { at: Date.now(), vector })
  return vector
}

/** Test seam: forget remembered query vectors. */
export function clearSemanticSearchCache(): void {
  vectors.clear()
}

/**
 * The viewer's records closest in meaning to the query, at most `depth` per
 * kind, scored titleTier + similarity. Never throws: any failure is logged
 * and yields no semantic matches.
 */
export async function searchWorkspaceSemantically(
  text: string,
  actor: Actor,
  kinds: readonly SearchKind[],
  depth: number,
  signal?: AbortSignal
): Promise<SearchResult[]> {
  const embedded = kinds.filter((kind) => kind in SEMANTIC_SEARCHERS)
  const model = getEmbeddingModel()
  if (embedded.length === 0 || !model) return []
  try {
    const vector = await queryVector(text, model, signal)
    if (!vector) return []
    const search = { text, vector, model, depth, actor }
    const lists = await Promise.all(
      embedded.map((kind) =>
        SEMANTIC_SEARCHERS[kind]!(search).then((rows) =>
          rows.map((row) => toSearchResult(kind, row, text))
        )
      )
    )
    return lists.flat()
  } catch (error) {
    log.warn({ err: error }, 'semantic workspace search failed; full-text results only')
    return []
  }
}

interface SemanticSearch {
  text: string
  vector: string
  model: string
  depth: number
  actor: Actor
}

type SemanticRow = {
  id: string
  title: string | null
  content: string | null
  updatedAt: Date | null
  score: number
  href?: string
}

/** Similarity for a vector column, and the predicates every kind shares. */
function closeness(column: SQL, modelColumn: SQL, { vector, model }: SemanticSearch) {
  const similarity = sql<number>`(1 - (${column} <=> ${vector}::vector))`
  return {
    similarity,
    where: and(
      isNotNull(column),
      sql`${modelColumn} = ${model}`,
      sql`${similarity} >= ${SEMANTIC_FLOOR}`
    )!,
    order: sql`${column} <=> ${vector}::vector`,
  }
}

const SEMANTIC_SEARCHERS: Partial<
  Record<SearchKind, (search: SemanticSearch) => Promise<SemanticRow[]>>
> = {
  post: async (search) => {
    const near = closeness(sql`${posts.embedding}`, sql`${posts.embeddingModel}`, search)
    return db
      .select({
        id: posts.id,
        title: posts.title,
        content: sql<string>`left(${posts.content}, 2000)`,
        updatedAt: posts.updatedAt,
        score: sql<number>`${titleTier(search.text, sql`${posts.title}`)} + ${near.similarity}`,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(and(postSearchScope(search.actor), near.where))
      .orderBy(near.order, posts.id)
      .limit(search.depth)
  },
  article: async (search) => {
    const { manager, conditions } = articleSearchScope(search.actor)
    const near = closeness(
      sql`${helpCenterArticles.embedding}`,
      sql`${helpCenterArticles.embeddingModel}`,
      search
    )
    const rows = await db
      .select({
        id: helpCenterArticles.id,
        urlId: helpCenterArticles.urlId,
        slug: helpCenterArticles.slug,
        title: helpCenterArticles.title,
        content: sql<string>`left(${helpCenterArticles.content}, 2000)`,
        updatedAt: helpCenterArticles.updatedAt,
        score: sql<number>`${titleTier(search.text, sql`${helpCenterArticles.title}`)} + ${near.similarity}`,
      })
      .from(helpCenterArticles)
      .innerJoin(helpCenterCategories, eq(helpCenterCategories.id, helpCenterArticles.categoryId))
      .where(and(...conditions, near.where))
      .orderBy(near.order, helpCenterArticles.id)
      .limit(search.depth)
    return rows.map((row) => ({ ...row, href: articleHref(manager, row) }))
  },
  changelog: async (search) => {
    const near = closeness(
      sql`${changelogEntries.embedding}`,
      sql`${changelogEntries.embeddingModel}`,
      search
    )
    return db
      .select({
        id: changelogEntries.id,
        title: changelogEntries.title,
        content: sql<string>`left(${changelogEntries.content}, 2000)`,
        updatedAt: changelogEntries.updatedAt,
        score: sql<number>`${titleTier(search.text, sql`${changelogEntries.title}`)} + ${near.similarity}`,
      })
      .from(changelogEntries)
      .where(and(changelogSearchScope(search.actor), near.where))
      .orderBy(near.order, changelogEntries.id)
      .limit(search.depth)
  },
  conversation: async (search) => {
    const near = closeness(
      sql`${conversationSummaries.embedding}`,
      sql`${conversationSummaries.embeddingModel}`,
      search
    )
    return db
      .select({
        id: conversations.id,
        title: conversations.subject,
        content: conversationSummaries.summary,
        updatedAt: conversations.updatedAt,
        score: sql<number>`${titleTier(search.text, sql`${conversations.subject}`)} + ${near.similarity}`,
      })
      .from(conversationSummaries)
      .innerJoin(conversations, eq(conversations.id, conversationSummaries.conversationId))
      .where(and(conversationFilter(search.actor), near.where))
      .orderBy(near.order, conversations.id)
      .limit(search.depth)
  },
  ticket: async (search) => {
    const near = closeness(
      sql`${ticketSummaries.embedding}`,
      sql`${ticketSummaries.embeddingModel}`,
      search
    )
    return db
      .select({
        id: tickets.id,
        title: tickets.title,
        content: ticketSummaries.summary,
        updatedAt: tickets.updatedAt,
        score: sql<number>`${titleTier(search.text, sql`${tickets.title}`)} + ${near.similarity}`,
      })
      .from(ticketSummaries)
      .innerJoin(tickets, eq(tickets.id, ticketSummaries.ticketId))
      .where(and(ticketFilter(search.actor), near.where))
      .orderBy(near.order, tickets.id)
      .limit(search.depth)
  },
}
