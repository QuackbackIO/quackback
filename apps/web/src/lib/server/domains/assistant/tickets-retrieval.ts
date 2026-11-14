/**
 * Closed-ticket grounding source for Quinn (Quinn Phase 4).
 *
 * A `KnowledgeSource` (see `./retrieval-sources`) over `ticket_summaries`
 * rows (see `./ticket-summary.service`), one AI resolution summary per closed
 * ticket. Ranking is semantic (pgvector cosine over `ticketSummaries.embedding`)
 * when a query embedding is available, keyword (ILIKE over the summary text)
 * otherwise — the same two-path shape as `conversation-summary-retrieval.ts`,
 * since ticket summaries share that table's shape (no tsvector column).
 *
 * THE STRUCTURAL CEILING: tickets are TEAM knowledge only. A closed support
 * ticket is never customer-facing material, so this source returns `[]`
 * unconditionally at the `public` ceiling — the copilot (team) is the only
 * surface that ever sees it. Every citation it produces is flagged
 * `internal: true` (the copilot leak gate), always: unlike posts or KB
 * articles there is no "public ticket" tier to distinguish. Registered only
 * per the agent's config-v3 knowledge toggles (see `resolveKnowledgeSources`),
 * default off.
 *
 * UNLIKE `conversation-summary-retrieval.ts`, this source is NOT customer-
 * scoped: a ticket's resolution is reusable across every requester. It IS
 * viewer-scoped: every query joins the parent ticket through
 * `ticketFilter(viewer)`, so a teammate only ever retrieves summaries of
 * tickets they could open themselves. The viewer is the asking teammate, never
 * Quinn's own service actor (which `ticketFilter` treats as workspace-wide), so
 * a missing or unscoped-service viewer returns nothing.
 */
import { db, ticketSummaries, tickets, and, desc, eq, ilike, sql } from '@/lib/server/db'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { isUnscopedService, type Actor } from '@/lib/server/policy/types'
import type { ContentAudience } from './audience'
import {
  KNOWLEDGE_SNIPPET_CHARS,
  type KnowledgeSource,
  type RetrievedItem,
} from './retrieval-sources'

/** Cosine-similarity floor for the semantic path. Rows below it are absent. */
export const TICKETS_SEMANTIC_SIMILARITY_FLOOR = 0.35

/** Default number of ticket summaries retrieved per query. */
export const TICKETS_TOP_K = 5

/** Recency window: a summary older than this is never retrieved, however well
 *  it matches. Mirrors the conversation-summaries window (180d). */
export const TICKETS_RECENCY_WINDOW_SQL = sql`now() - interval '180 days'`

/** Generic title: a ticket summary has no natural headline, and the excerpt
 *  (the summary text itself) carries the content the model reasons over. */
const TICKET_TITLE = 'Resolved ticket'

/** Admin unified-inbox deep link for a closed ticket (team surface only —
 *  copilot is the sole consumer). `?i=` accepts a ticket id per the
 *  `?t=`→`?i=` alias in routes/admin/tickets.tsx. */
function ticketUrl(ticketId: string): string {
  return `/admin/inbox?i=${ticketId}`
}

export interface RetrievedTicketSummary {
  ticketId: string
  summary: string
  score: number
  /** When the summary row was created (≈ when the ticket closed), for the
   *  copilot citation freshness line (see RetrievedItem.updatedAt). */
  createdAt: Date
}

export interface RetrieveTicketSummariesOptions {
  topK?: number
  minScore?: number
  /** The teammate the copilot answers. Bounds retrieval to the tickets they
   *  can see; absent means nothing is returned. */
  viewer?: Actor
}

interface TicketSummaryRow {
  ticketId: string
  summary: string
  score: number
  createdAt: Date
}

/** Semantic path: cosine similarity over the stored embedding, within the
 *  recency window and the viewer's ticket scope. */
async function hybridQuery(
  embedding: number[],
  topK: number,
  minScore: number,
  viewer: Actor
): Promise<TicketSummaryRow[]> {
  const vectorStr = `[${embedding.join(',')}]`
  const score = sql<number>`1 - (${ticketSummaries.embedding} <=> ${vectorStr}::vector)`

  return db
    .select({
      ticketId: ticketSummaries.ticketId,
      summary: ticketSummaries.summary,
      score: score.as('score'),
      createdAt: ticketSummaries.createdAt,
    })
    .from(ticketSummaries)
    .innerJoin(tickets, eq(tickets.id, ticketSummaries.ticketId))
    .where(
      and(
        ticketFilter(viewer),
        sql`${ticketSummaries.createdAt} >= ${TICKETS_RECENCY_WINDOW_SQL}`,
        sql`${ticketSummaries.embedding} IS NOT NULL`,
        sql`1 - (${ticketSummaries.embedding} <=> ${vectorStr}::vector) > ${minScore}`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}

/** Keyword-only fallback when embedding generation is unavailable: a plain
 *  ILIKE over the summary text (no tsvector column on this table), newest
 *  first. An ILIKE hit carries no relevance signal, so its score is 0, never a
 *  fabricated top-of-scale value — see the conversation-summaries source for
 *  why a no-signal row must sort behind genuinely scored items in the merge. */
async function keywordQuery(
  query: string,
  topK: number,
  viewer: Actor
): Promise<TicketSummaryRow[]> {
  const pattern = `%${query}%`

  return db
    .select({
      ticketId: ticketSummaries.ticketId,
      summary: ticketSummaries.summary,
      score: sql<number>`0`.as('score'),
      createdAt: ticketSummaries.createdAt,
    })
    .from(ticketSummaries)
    .innerJoin(tickets, eq(tickets.id, ticketSummaries.ticketId))
    .where(
      and(
        ticketFilter(viewer),
        sql`${ticketSummaries.createdAt} >= ${TICKETS_RECENCY_WINDOW_SQL}`,
        ilike(ticketSummaries.summary, pattern)
      )
    )
    .orderBy(desc(ticketSummaries.createdAt))
    .limit(topK)
}

/**
 * Retrieve the top-k most relevant closed-ticket resolution summaries the
 * viewer can see. Team knowledge only: a `public` turn returns nothing,
 * unconditionally, and so does a turn with no viewer or a viewer that is an
 * unscoped service principal (Quinn's own actor must never stand in for the
 * teammate).
 */
export async function retrieveTicketSummaries(
  query: string,
  ceiling: ContentAudience,
  options: RetrieveTicketSummariesOptions = {}
): Promise<RetrievedTicketSummary[]> {
  if (ceiling === 'public') return []
  const viewer = options.viewer
  if (!viewer || isUnscopedService(viewer)) return []

  const topK = options.topK ?? TICKETS_TOP_K
  const minScore = options.minScore ?? TICKETS_SEMANTIC_SIMILARITY_FLOOR

  const embedding = await generateEmbedding(query, {
    pipelineStep: 'assistant_tickets_query',
  })

  const rows = embedding
    ? await hybridQuery(embedding, topK, minScore, viewer)
    : await keywordQuery(query, topK, viewer)

  return rows.map((r) => ({
    ticketId: r.ticketId,
    summary: r.summary,
    score: Number(r.score),
    createdAt: r.createdAt,
  }))
}

/**
 * The closed-tickets `KnowledgeSource`: wraps `retrieveTicketSummaries`,
 * mapping its team-only rows onto `RetrievedItem`. Dynamically imported by
 * `resolveKnowledgeSources` only when `assistantKnowledge` is on. The item id
 * (and the citation's `id`) is the TICKET's id, not the summary row's own id —
 * that is what the copilot citation links to.
 */
export const ticketsKnowledgeSource: KnowledgeSource = {
  sourceType: 'ticket',
  async retrieve(query, ceiling, opts) {
    const rows = await retrieveTicketSummaries(query, ceiling, {
      topK: opts.topK,
      viewer: opts.viewer,
    })
    return rows.map((r): RetrievedItem => ({
      id: r.ticketId,
      sourceType: 'ticket' as const,
      title: TICKET_TITLE,
      excerpt: r.summary.slice(0, KNOWLEDGE_SNIPPET_CHARS),
      score: r.score,
      updatedAt: r.createdAt.toISOString(),
      citation: {
        type: 'ticket' as const,
        id: r.ticketId,
        title: TICKET_TITLE,
        url: ticketUrl(r.ticketId),
        // A support ticket is never customer-facing knowledge: always
        // flagged for the copilot leak gate, on every (team) surface.
        internal: true,
      },
    }))
  },
}
