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
  toSearchResult,
} from './ask-search'
import { bestFirst, titleContains, titleTier } from './search-match'

const log = logger.child({ module: 'workspace-semantic-search' })

/** Below this cosine similarity a record is not a match (as in help center search). */
export const SEMANTIC_FLOOR = 0.35
const VECTOR_TTL_MS = 10 * 60_000

interface CachedVector {
  at: number
  /** Null when the request failed or timed out: kept too, so a query's later
   *  pages rank without meaning matches exactly as its first page did. */
  vector: string | null
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
  const miss = () => vectors.set(key, { at: Date.now(), vector: null })
  let embedding: number[] | null
  try {
    embedding = await generateEmbedding(
      text,
      { pipelineStep: 'workspace_search_query' },
      { signal }
    )
  } catch (err) {
    miss()
    throw err
  }
  if (!embedding || signal?.aborted) {
    miss()
    return null
  }
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

/** One kind's query: the rows matching `where`, scored `score`, in `orderBy`, at most depth. */
type KindQuery<R extends SemanticRow> = (
  where: SQL,
  score: SQL<number>,
  orderBy: SQL[]
) => Promise<R[]>

/** Best first, as compareSearchResults: score, newest (no time sorts oldest), then id. */
function byRank(a: SemanticRow, b: SemanticRow): number {
  return (
    Number(b.score) - Number(a.score) ||
    (b.updatedAt?.getTime() ?? -Infinity) - (a.updatedAt?.getTime() ?? -Infinity) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

/**
 * The kind's best `depth` rows by score = titleTier + similarity, from two
 * index-served candidate sets: the nearest rows by distance (HNSW), and the
 * rows whose title contains the query (trigram), best score first. Every row
 * that belongs in the top `depth` is in one of them: a title match is in the
 * second, and a row with no title match scores its similarity alone, so
 * anything above it is also in the top `depth` and it is among the nearest.
 */
async function bestByScore<R extends SemanticRow>(
  search: SemanticSearch,
  vector: SQL,
  model: SQL,
  columns: { title: SQL; updatedAt: SQL; id: SQL },
  query: KindQuery<R>
): Promise<R[]> {
  const near = closeness(vector, model, search)
  const score = sql<number>`${titleTier(search.text, columns.title)} + ${near.similarity}`
  const contains = titleContains(search.text, columns.title)
  const [nearest, titled] = await Promise.all([
    query(near.where, score, [near.order, columns.id]),
    contains
      ? query(and(near.where, contains)!, score, bestFirst(score, columns.updatedAt, columns.id))
      : Promise.resolve([]),
  ])
  const byId = new Map<string, R>()
  for (const row of [...titled, ...nearest]) if (!byId.has(row.id)) byId.set(row.id, row)
  return [...byId.values()].sort(byRank).slice(0, search.depth)
}

const SEMANTIC_SEARCHERS: Partial<
  Record<SearchKind, (search: SemanticSearch) => Promise<SemanticRow[]>>
> = {
  post: (search) =>
    bestByScore(
      search,
      sql`${posts.embedding}`,
      sql`${posts.embeddingModel}`,
      { title: sql`${posts.title}`, updatedAt: sql`${posts.updatedAt}`, id: sql`${posts.id}` },
      (where, score, orderBy) =>
        db
          .select({
            id: posts.id,
            title: posts.title,
            content: sql<string>`left(${posts.content}, 2000)`,
            updatedAt: posts.updatedAt,
            score,
          })
          .from(posts)
          .innerJoin(boards, eq(boards.id, posts.boardId))
          .where(and(postSearchScope(search.actor), where))
          .orderBy(...orderBy)
          .limit(search.depth)
    ),
  article: async (search) => {
    const { manager, conditions } = articleSearchScope(search.actor)
    const rows = await bestByScore(
      search,
      sql`${helpCenterArticles.embedding}`,
      sql`${helpCenterArticles.embeddingModel}`,
      {
        title: sql`${helpCenterArticles.title}`,
        updatedAt: sql`${helpCenterArticles.updatedAt}`,
        id: sql`${helpCenterArticles.id}`,
      },
      (where, score, orderBy) =>
        db
          .select({
            id: helpCenterArticles.id,
            urlId: helpCenterArticles.urlId,
            slug: helpCenterArticles.slug,
            title: helpCenterArticles.title,
            content: sql<string>`left(${helpCenterArticles.content}, 2000)`,
            updatedAt: helpCenterArticles.updatedAt,
            score,
          })
          .from(helpCenterArticles)
          .innerJoin(
            helpCenterCategories,
            eq(helpCenterCategories.id, helpCenterArticles.categoryId)
          )
          .where(and(...conditions, where))
          .orderBy(...orderBy)
          .limit(search.depth)
    )
    return rows.map((row) => ({ ...row, href: articleHref(manager, row) }))
  },
  changelog: (search) =>
    bestByScore(
      search,
      sql`${changelogEntries.embedding}`,
      sql`${changelogEntries.embeddingModel}`,
      {
        title: sql`${changelogEntries.title}`,
        updatedAt: sql`${changelogEntries.updatedAt}`,
        id: sql`${changelogEntries.id}`,
      },
      (where, score, orderBy) =>
        db
          .select({
            id: changelogEntries.id,
            title: changelogEntries.title,
            content: sql<string>`left(${changelogEntries.content}, 2000)`,
            updatedAt: changelogEntries.updatedAt,
            score,
          })
          .from(changelogEntries)
          .where(and(changelogSearchScope(search.actor), where))
          .orderBy(...orderBy)
          .limit(search.depth)
    ),
  conversation: (search) =>
    bestByScore(
      search,
      sql`${conversationSummaries.embedding}`,
      sql`${conversationSummaries.embeddingModel}`,
      {
        title: sql`${conversations.subject}`,
        updatedAt: sql`${conversations.updatedAt}`,
        id: sql`${conversations.id}`,
      },
      (where, score, orderBy) =>
        db
          .select({
            id: conversations.id,
            title: conversations.subject,
            content: conversationSummaries.summary,
            updatedAt: conversations.updatedAt,
            score,
          })
          .from(conversationSummaries)
          .innerJoin(conversations, eq(conversations.id, conversationSummaries.conversationId))
          .where(and(conversationFilter(search.actor), where))
          .orderBy(...orderBy)
          .limit(search.depth)
    ),
  ticket: (search) =>
    bestByScore(
      search,
      sql`${ticketSummaries.embedding}`,
      sql`${ticketSummaries.embeddingModel}`,
      {
        title: sql`${tickets.title}`,
        updatedAt: sql`${tickets.updatedAt}`,
        id: sql`${tickets.id}`,
      },
      (where, score, orderBy) =>
        db
          .select({
            id: tickets.id,
            title: tickets.title,
            content: ticketSummaries.summary,
            updatedAt: tickets.updatedAt,
            score,
          })
          .from(ticketSummaries)
          .innerJoin(tickets, eq(tickets.id, ticketSummaries.ticketId))
          .where(and(ticketFilter(search.actor), where))
          .orderBy(...orderBy)
          .limit(search.depth)
    ),
}
