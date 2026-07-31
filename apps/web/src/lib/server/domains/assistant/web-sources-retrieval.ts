/**
 * Web-source grounding for Quinn.
 *
 * A `KnowledgeSource` (see `./retrieval-sources`) over admin-added
 * `assistant_web_sources` rows (see `./web-source.service`): pages crawled
 * from public URLs at add time. Ranking is keyword-only — a per-term ILIKE
 * over title/content scoring each row by how many query terms it covers
 * (the same ILIKE shape as the snippets keyword fallback); rows carry no
 * embedding column.
 * Every row is public by construction (the page was publicly fetchable), so
 * the source serves every retrieval ceiling and the turn's ceiling is not
 * consulted; the citation links back to the original external URL and is
 * never flagged internal.
 */
import { db, assistantWebSources, and, desc, eq, ilike, or, sql } from '@/lib/server/db'
import {
  KNOWLEDGE_SNIPPET_CHARS,
  type KnowledgeSource,
  type RetrievedItem,
} from './retrieval-sources'

/** Default number of web sources retrieved per query. */
export const WEB_SOURCES_TOP_K = 5

export interface RetrievedWebSource {
  id: string
  url: string
  title: string
  content: string
  score: number
  updatedAt: Date
}

/**
 * Retrieve the top-k most relevant enabled web sources for a query. Keyword
 * matching is per-term (words of 3+ characters, OR'd): a customer's question
 * is a sentence, and the useful signal is which of its content words the
 * page contains — requiring the whole phrase to appear verbatim would match
 * nothing. The score counts matched terms, so the page covering more of the
 * question ranks first. Always returns an array; empty means nothing
 * relevant (or nothing enabled) was found.
 */
export async function retrieveWebSources(
  query: string,
  options: { topK?: number } = {}
): Promise<RetrievedWebSource[]> {
  const topK = options.topK ?? WEB_SOURCES_TOP_K
  const terms = query.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3)
  const effective = terms.length > 0 ? terms : [query]

  const matchConds = effective.map((term) => {
    const pattern = `%${term}%`
    return or(
      ilike(assistantWebSources.title, pattern),
      ilike(assistantWebSources.content, pattern)
    )
  })
  const scoreParts = effective.map((term) => {
    const pattern = `%${term}%`
    return sql`CASE WHEN (${assistantWebSources.title} ILIKE ${pattern} OR ${assistantWebSources.content} ILIKE ${pattern}) THEN 1.0 ELSE 0.0 END`
  })
  const score = sql<number>`(${sql.join(scoreParts, sql` + `)})`

  const rows = await db
    .select({
      id: assistantWebSources.id,
      url: assistantWebSources.url,
      title: assistantWebSources.title,
      content: assistantWebSources.content,
      score: score.as('score'),
      updatedAt: assistantWebSources.updatedAt,
    })
    .from(assistantWebSources)
    .where(and(eq(assistantWebSources.enabled, true), or(...matchConds)))
    .orderBy(sql`score DESC`, desc(assistantWebSources.updatedAt))
    .limit(topK)

  return rows.map((r) => ({ ...r, score: Number(r.score) }))
}

/**
 * The web-source `KnowledgeSource`: wraps `retrieveWebSources`, mapping its
 * rows onto `RetrievedItem`. Dynamically imported by `resolveKnowledgeSources`
 * only when 'webpage' is in the turn's enabled-source set. The citation URL
 * is the original external page URL — that is the whole point of the source
 * (the customer can open the page the answer came from) — so it is never
 * flagged internal.
 */
export const webpageKnowledgeSource: KnowledgeSource = {
  sourceType: 'webpage',
  async retrieve(query, _ceiling, opts) {
    const rows = await retrieveWebSources(query, { topK: opts.topK })
    return rows.map(
      (w): RetrievedItem => ({
        id: w.id,
        sourceType: 'webpage' as const,
        title: w.title,
        excerpt: w.content.slice(0, KNOWLEDGE_SNIPPET_CHARS),
        score: w.score,
        updatedAt: w.updatedAt.toISOString(),
        citation: {
          type: 'webpage' as const,
          id: w.id,
          title: w.title,
          url: w.url,
        },
      })
    )
  },
}
