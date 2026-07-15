/**
 * Snippets grounding source for Quinn.
 *
 * A third `KnowledgeSource` (see `./retrieval-sources`) alongside the
 * knowledge base and feedback posts: retrieval over admin-curated
 * `assistant_snippets` rows (see `./snippet.service`), scoped by the turn's
 * `ContentAudience` ceiling rather than a surface allowlist. Ranking is
 * semantic (pgvector cosine over `assistantSnippets.embedding`) when a query
 * embedding is available; snippets have no tsvector column, so the fallback
 * is a plain keyword ILIKE over title/content rather than a ts_rank blend.
 * registered per the agent's config-v3 knowledge toggles (resolveAssistantKnowledgeSnapshot)
 * `resolveKnowledgeSources`), default off.
 */
import { db, assistantSnippets, and, desc, eq, ilike, inArray, or, sql } from '@/lib/server/db'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { CONTENT_AUDIENCE_RANK, type ContentAudience } from './audience'
import {
  KNOWLEDGE_SNIPPET_CHARS,
  type KnowledgeSource,
  type RetrievedItem,
} from './retrieval-sources'

/** Cosine-similarity floor for the semantic path. Rows below it are absent. */
export const SNIPPETS_SEMANTIC_SIMILARITY_FLOOR = 0.35

/** Default number of snippets retrieved per query. */
export const SNIPPETS_ASK_TOP_K = 5

export interface RetrievedSnippet {
  id: string
  title: string
  content: string
  score: number
  /** The snippet's own audience tier, for the copilot leak gate: anything but
   *  'public' is flagged internal by the source adapter below. */
  audience: ContentAudience
  /** The row's last-update timestamp, for the copilot citation freshness line
   *  (see RetrievedItem.updatedAt in retrieval-sources.ts). */
  updatedAt: Date
}

export interface RetrieveSnippetsOptions {
  topK?: number
  minScore?: number
}

/**
 * The audiences no more restricted than `ceiling`, in `ContentAudience` rank
 * order. A `public`-ceiling caller (a customer-facing surface, in principle
 * — snippets are only ever wired to team/internal-facing surfaces today) only
 * matches `public` rows; an `internal`-ceiling caller matches everything.
 */
function audiencesUpTo(ceiling: ContentAudience): ContentAudience[] {
  const ceilingRank = CONTENT_AUDIENCE_RANK[ceiling]
  return (Object.keys(CONTENT_AUDIENCE_RANK) as ContentAudience[]).filter(
    (audience) => CONTENT_AUDIENCE_RANK[audience] <= ceilingRank
  )
}

/**
 * THE visibility predicate for snippets retrieved as assistant grounding,
 * parameterized by the turn's retrieval ceiling. Every snippet query in this
 * module builds its predicate from this single owner. Always excludes
 * disabled snippets; the audience allow-list is derived from the ceiling's
 * rank so a snippet can never surface above what the viewer is allowed to see.
 */
export function snippetsVisibilityConditions(ceiling: ContentAudience) {
  return [
    eq(assistantSnippets.enabled, true),
    inArray(assistantSnippets.audience, audiencesUpTo(ceiling)),
  ]
}

interface SnippetRow {
  id: string
  title: string
  content: string
  score: number
  audience: ContentAudience
  updatedAt: Date
}

/** Semantic path: cosine similarity over the stored embedding. */
async function hybridQuery(
  embedding: number[],
  ceiling: ContentAudience,
  topK: number,
  minScore: number
): Promise<SnippetRow[]> {
  const vectorStr = `[${embedding.join(',')}]`
  const score = sql<number>`1 - (${assistantSnippets.embedding} <=> ${vectorStr}::vector)`

  return db
    .select({
      id: assistantSnippets.id,
      title: assistantSnippets.title,
      content: assistantSnippets.content,
      score: score.as('score'),
      audience: assistantSnippets.audience,
      updatedAt: assistantSnippets.updatedAt,
    })
    .from(assistantSnippets)
    .where(
      and(
        ...snippetsVisibilityConditions(ceiling),
        sql`${assistantSnippets.embedding} IS NOT NULL`,
        sql`1 - (${assistantSnippets.embedding} <=> ${vectorStr}::vector) > ${minScore}`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}

/** Keyword-only fallback when embedding generation is unavailable: a plain
 *  ILIKE over title/content (no tsvector column on this table), title hits
 *  ranked above content-only hits. */
async function keywordQuery(
  query: string,
  ceiling: ContentAudience,
  topK: number
): Promise<SnippetRow[]> {
  const pattern = `%${query}%`
  const score = sql<number>`CASE WHEN ${assistantSnippets.title} ILIKE ${pattern} THEN 1.0 ELSE 0.5 END`

  return db
    .select({
      id: assistantSnippets.id,
      title: assistantSnippets.title,
      content: assistantSnippets.content,
      score: score.as('score'),
      audience: assistantSnippets.audience,
      updatedAt: assistantSnippets.updatedAt,
    })
    .from(assistantSnippets)
    .where(
      and(
        ...snippetsVisibilityConditions(ceiling),
        or(ilike(assistantSnippets.title, pattern), ilike(assistantSnippets.content, pattern))
      )
    )
    .orderBy(sql`score DESC`, desc(assistantSnippets.updatedAt))
    .limit(topK)
}

/**
 * Retrieve the top-k most relevant snippets for a query, scoped to the turn's
 * retrieval ceiling. Mirrors `retrievePosts`'s two-path shape: semantic when
 * a query embedding is available, keyword (ILIKE) otherwise. Always returns
 * an array; empty means nothing relevant (or visible) was found.
 */
export async function retrieveSnippets(
  query: string,
  ceiling: ContentAudience,
  options: RetrieveSnippetsOptions = {}
): Promise<RetrievedSnippet[]> {
  const topK = options.topK ?? SNIPPETS_ASK_TOP_K
  const minScore = options.minScore ?? SNIPPETS_SEMANTIC_SIMILARITY_FLOOR

  const embedding = await generateEmbedding(query, {
    pipelineStep: 'assistant_snippets_retrieval_query_embedding',
  })

  const rows = embedding
    ? await hybridQuery(embedding, ceiling, topK, minScore)
    : await keywordQuery(query, ceiling, topK)

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content ?? '',
    score: Number(r.score),
    audience: r.audience,
    updatedAt: r.updatedAt,
  }))
}

/**
 * The snippets `KnowledgeSource`: wraps `retrieveSnippets`, mapping its
 * audience-scoped rows onto `RetrievedItem`. Dynamically imported by
 * `resolveKnowledgeSources` only when `assistantKnowledge` is on. A snippet
 * has no URL of its own — it is a private fact, not a page — so its citation
 * is title-referential only (`url: ''`).
 */
export const snippetsKnowledgeSource: KnowledgeSource = {
  sourceType: 'snippet',
  async retrieve(query, ceiling) {
    const rows = await retrieveSnippets(query, ceiling)
    return rows.map(
      (s): RetrievedItem => ({
        id: s.id,
        sourceType: 'snippet' as const,
        title: s.title,
        excerpt: s.content.slice(0, KNOWLEDGE_SNIPPET_CHARS),
        score: s.score,
        updatedAt: s.updatedAt.toISOString(),
        citation: {
          type: 'snippet' as const,
          id: s.id,
          title: s.title,
          url: '',
          // A snippet is only ever surfaced to a viewer whose ceiling covers
          // its audience, but 'team'/'internal' snippets are still not
          // customer-safe: flag them for the copilot leak gate.
          ...(s.audience === 'public' ? {} : { internal: true }),
        },
      })
    )
  },
}
