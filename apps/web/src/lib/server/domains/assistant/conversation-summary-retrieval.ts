/**
 * Past-conversation-summaries grounding source for Quinn (P2-A.4).
 *
 * A fourth `KnowledgeSource` (see `./retrieval-sources`) alongside the
 * knowledge base, feedback posts, and admin-curated snippets: retrieval over
 * `conversation_summaries` rows (see `./conversation-summary.service`),
 * generated once per conversation when it closes. Ranking is semantic
 * (pgvector cosine over `conversationSummaries.embedding`) when a query
 * embedding is available, keyword (ILIKE over the summary text) otherwise —
 * mirrors `snippets-retrieval.ts`'s two-path shape.
 *
 * THE SAFETY-CRITICAL DIFFERENCE from every other source: this one is scoped
 * per CUSTOMER, not per audience ceiling. `ContentAudience` governs how
 * privileged a piece of CONTENT is (public/team/internal); it says nothing
 * about WHOSE history a viewer may read. A conversation's own summary is
 * never more than as private as that customer's other conversations, so the
 * ceiling plays no role here — the mandatory predicate is
 * `visitorPrincipalId = <the current conversation's customer>`, always, on
 * every surface. Without it, one customer's support history would leak into
 * another customer's answer, which is a severe breach — worse than getting
 * the audience ceiling wrong, since the mistake crosses tenants' own
 * customers rather than merely over-sharing content tier.
 *
 * `retrieveConversationSummaries` enforces this by refusing to run at all
 * without a `customerPrincipalId`: a caller with no real customer to scope to
 * (the admin sandbox, or a context nobody threaded a conversation into) gets
 * `[]`, never an unscoped query. Never relax this into "no filter" as a
 * fallback — a missing scope must read as "nothing", not "everything".
 * Registered only behind the `assistantConversationGrounding` flag (see
 * `resolveKnowledgeSources`), default off.
 */
import { db, conversationSummaries, and, desc, eq, ilike, ne, sql } from '@/lib/server/db'
import type { PrincipalId, ConversationId } from '@quackback/ids'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import type { ContentAudience } from './audience'
import {
  KNOWLEDGE_SNIPPET_CHARS,
  type KnowledgeSource,
  type RetrievedItem,
} from './retrieval-sources'

/** Cosine-similarity floor for the semantic path. Rows below it are absent. */
export const CONVERSATION_SUMMARIES_SEMANTIC_SIMILARITY_FLOOR = 0.35

/** Default number of past summaries retrieved per query. */
export const CONVERSATION_SUMMARIES_TOP_K = 5

/** Recency window: a summary older than this is never retrieved, however well it matches. */
export const CONVERSATION_SUMMARIES_RECENCY_WINDOW_SQL = sql`now() - interval '180 days'`

/** Generic title: a past conversation has no natural headline the way a KB
 *  article or a post does, and the excerpt (the summary text itself) carries
 *  the actual content the model reasons over. */
const PAST_CONVERSATION_TITLE = 'Past conversation'

export interface RetrievedConversationSummary {
  conversationId: string
  summary: string
  score: number
}

export interface RetrieveConversationSummariesOptions {
  topK?: number
  minScore?: number
  /** The current conversation's customer. Absent means no results — see the module doc. */
  customerPrincipalId?: PrincipalId
  /** The current conversation, excluded so a turn never grounds on its own in-progress summary. */
  conversationId?: ConversationId | null
}

/**
 * THE mandatory scope predicate for a conversation-summaries query, shared by
 * both retrieval paths below so neither can drift from the other: only rows
 * belonging to `customerPrincipalId`, within the recency window, excluding
 * `excludeConversationId` (the turn's own in-progress conversation) when
 * given. Every summary query in this module builds its `WHERE` from this one
 * function — there is no other route to this table.
 */
function conversationSummariesScopeConditions(
  customerPrincipalId: PrincipalId,
  excludeConversationId: ConversationId | null
) {
  const conditions = [
    eq(conversationSummaries.visitorPrincipalId, customerPrincipalId),
    sql`${conversationSummaries.createdAt} >= ${CONVERSATION_SUMMARIES_RECENCY_WINDOW_SQL}`,
  ]
  if (excludeConversationId) {
    conditions.push(ne(conversationSummaries.conversationId, excludeConversationId))
  }
  return conditions
}

interface SummaryRow {
  conversationId: string
  summary: string
  score: number
}

/** Semantic path: cosine similarity over the stored embedding. */
async function hybridQuery(
  embedding: number[],
  customerPrincipalId: PrincipalId,
  excludeConversationId: ConversationId | null,
  topK: number,
  minScore: number
): Promise<SummaryRow[]> {
  const vectorStr = `[${embedding.join(',')}]`
  const score = sql<number>`1 - (${conversationSummaries.embedding} <=> ${vectorStr}::vector)`

  return db
    .select({
      conversationId: conversationSummaries.conversationId,
      summary: conversationSummaries.summary,
      score: score.as('score'),
    })
    .from(conversationSummaries)
    .where(
      and(
        ...conversationSummariesScopeConditions(customerPrincipalId, excludeConversationId),
        sql`${conversationSummaries.embedding} IS NOT NULL`,
        sql`1 - (${conversationSummaries.embedding} <=> ${vectorStr}::vector) > ${minScore}`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}

/** Keyword-only fallback when embedding generation is unavailable: a plain
 *  ILIKE over the summary text (no tsvector column on this table), newest first. */
async function keywordQuery(
  query: string,
  customerPrincipalId: PrincipalId,
  excludeConversationId: ConversationId | null,
  topK: number
): Promise<SummaryRow[]> {
  const pattern = `%${query}%`

  return db
    .select({
      conversationId: conversationSummaries.conversationId,
      summary: conversationSummaries.summary,
      score: sql<number>`1`.as('score'),
    })
    .from(conversationSummaries)
    .where(
      and(
        ...conversationSummariesScopeConditions(customerPrincipalId, excludeConversationId),
        ilike(conversationSummaries.summary, pattern)
      )
    )
    .orderBy(desc(conversationSummaries.createdAt))
    .limit(topK)
}

/**
 * Retrieve the top-k most relevant past-conversation summaries for the SAME
 * customer as the current conversation. `ceiling` is accepted for
 * `KnowledgeSource` conformance but unused: this source's scope is the
 * customer, not the content-audience tier (see the module doc). Returns `[]`
 * without querying anything when `customerPrincipalId` is absent — the one
 * mandatory guard this whole module exists to enforce.
 */
export async function retrieveConversationSummaries(
  query: string,
  _ceiling: ContentAudience,
  options: RetrieveConversationSummariesOptions = {}
): Promise<RetrievedConversationSummary[]> {
  const { customerPrincipalId } = options
  if (!customerPrincipalId) return []

  const topK = options.topK ?? CONVERSATION_SUMMARIES_TOP_K
  const minScore = options.minScore ?? CONVERSATION_SUMMARIES_SEMANTIC_SIMILARITY_FLOOR
  const excludeConversationId = options.conversationId ?? null

  const embedding = await generateEmbedding(query, {
    pipelineStep: 'assistant_conversation_summaries_retrieval_query_embedding',
  })

  const rows = embedding
    ? await hybridQuery(embedding, customerPrincipalId, excludeConversationId, topK, minScore)
    : await keywordQuery(query, customerPrincipalId, excludeConversationId, topK)

  return rows.map((r) => ({
    conversationId: r.conversationId,
    summary: r.summary,
    score: Number(r.score),
  }))
}

/**
 * The conversation-summaries `KnowledgeSource`: wraps
 * `retrieveConversationSummaries`, mapping its customer-scoped rows onto
 * `RetrievedItem`. Dynamically imported by `resolveKnowledgeSources` only
 * when `assistantConversationGrounding` is on. The item id (and the
 * citation's `id`) is the PAST CONVERSATION's id, not the summary row's own
 * id — that is what "links to the past conversation" means, and it is what
 * the model cites back.
 */
export const conversationSummariesKnowledgeSource: KnowledgeSource = {
  sourceType: 'summary',
  async retrieve(query, ceiling, opts) {
    const rows = await retrieveConversationSummaries(query, ceiling, {
      topK: opts.topK,
      customerPrincipalId: opts.customerPrincipalId,
      conversationId: opts.conversationId,
    })
    return rows.map(
      (r): RetrievedItem => ({
        id: r.conversationId,
        sourceType: 'summary' as const,
        title: PAST_CONVERSATION_TITLE,
        excerpt: r.summary.slice(0, KNOWLEDGE_SNIPPET_CHARS),
        score: r.score,
        citation: {
          type: 'summary' as const,
          id: r.conversationId,
          title: PAST_CONVERSATION_TITLE,
          // No cross-surface-safe URL: unlike a KB article or a post, a past
          // conversation isn't necessarily viewable from wherever this
          // citation renders (e.g. the widget), so this stays title-referential
          // only, like a snippet's.
          url: '',
          // Always internal: another conversation's content is never
          // customer-facing material, regardless of the turn's audience
          // ceiling (this source is customer-scoped, not audience-scoped;
          // see the module doc).
          internal: true,
        },
      })
    )
  },
}
