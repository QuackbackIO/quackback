/**
 * Changelog grounding source for Quinn (Quinn Phase 4).
 *
 * A `KnowledgeSource` (see `./retrieval-sources`) over `changelog_entries`:
 * retrieval with the same audience-scoped hybrid shape as `posts-retrieval.ts`
 * — semantic (pgvector cosine over `changelogEntries.embedding`) blended with
 * a keyword arm when a query embedding is available, keyword-only otherwise.
 * Entries are embedded on publish/edit by `changelog-embedding.service.ts`;
 * `changelog_entries` has no tsvector column, so the keyword arm is an ILIKE
 * over title/content rather than a ts_rank (the one shape difference from
 * posts).
 *
 * THE VISIBILITY CEILING: a `public` ceiling (the Agent) sees PUBLISHED
 * entries only — the customer-facing changelog — cited with a public
 * `/changelog/<id>` URL and never flagged internal. A `team`/`internal`
 * ceiling (the copilot) ALSO sees drafts and scheduled entries, flagged
 * `internal: true` (the copilot leak gate) and linked to the admin editor.
 * Registered behind the `assistantKnowledge` flag (see
 * `resolveKnowledgeSources`); per-agent toggles arrive in Phase 3.
 */
import { db, changelogEntries, and, isNull, sql } from '@/lib/server/db'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import type { ContentAudience } from './audience'
import {
  KNOWLEDGE_SNIPPET_CHARS,
  type KnowledgeSource,
  type RetrievedItem,
} from './retrieval-sources'

/** Blend weights for the hybrid score. Mirrors the posts retrieval tuning
 *  (posts-retrieval.ts) but kept as its own constants — the two corpora may
 *  need to diverge as usage data comes in. */
export const CHANGELOG_KEYWORD_WEIGHT = 0.4
export const CHANGELOG_SEMANTIC_WEIGHT = 0.6

/** Cosine-similarity floor for the semantic arm. Rows below it are absent. */
export const CHANGELOG_SEMANTIC_SIMILARITY_FLOOR = 0.35

/** Default number of changelog entries retrieved per query. */
export const CHANGELOG_TOP_K = 5

/** Per-entry content budget for the retrieval context (trimmed in SQL). */
export const CHANGELOG_CONTEXT_CHARS = 4000

/** Public changelog path for a published entry. */
function publicChangelogUrl(entryId: string): string {
  return `/changelog/${entryId}`
}

/** Admin changelog editor deep link for a draft/scheduled entry (team only). */
function adminChangelogUrl(entryId: string): string {
  return `/admin/changelog?entry=${entryId}`
}

/**
 * THE visibility predicate for changelog entries retrieved as grounding,
 * parameterized by the turn's retrieval ceiling. Every changelog query in this
 * module builds its predicate from this single owner.
 *
 * Always excludes soft-deleted entries. Beyond that the ceiling decides: a
 * `public` ceiling (the Agent) only sees PUBLISHED entries (`published_at` set
 * and not in the future) — the same slice the public changelog site serves —
 * so a draft or scheduled entry can never reach a customer-facing turn. A
 * `team`/`internal` ceiling (the copilot) sees every non-deleted entry,
 * relying on the per-row `isPublished` flag for the copilot leak gate.
 */
export function changelogVisibilityConditions(ceiling: ContentAudience) {
  const base = [isNull(changelogEntries.deletedAt)]
  if (ceiling === 'public') {
    return [
      ...base,
      sql`${changelogEntries.publishedAt} IS NOT NULL`,
      sql`${changelogEntries.publishedAt} <= now()`,
    ]
  }
  return base
}

/** Select the entry content pre-trimmed to the context budget. */
const trimmedContent = () =>
  sql<string>`left(${changelogEntries.content}, ${CHANGELOG_CONTEXT_CHARS})`

/** Whether the entry is publicly live right now (published, not future-dated),
 *  computed per row so a `team` query can tell a published entry from a
 *  draft/scheduled one for the leak gate + URL choice. */
const isPublished = () =>
  sql<boolean>`(${changelogEntries.publishedAt} IS NOT NULL AND ${changelogEntries.publishedAt} <= now())`

export interface RetrievedChangelogEntry {
  id: string
  title: string
  content: string
  score: number
  /** Whether the entry is publicly live: drives the citation URL (public vs
   *  admin) and the copilot leak gate on a `team` ceiling. */
  isPublished: boolean
  /** The row's last-update timestamp, for the copilot citation freshness line. */
  updatedAt: Date
}

export interface RetrieveChangelogOptions {
  topK?: number
  minScore?: number
}

interface ChangelogRow {
  id: string
  title: string
  content: string
  score: number
  isPublished: boolean
  updatedAt: Date
}

/**
 * Hybrid retrieval: an entry matches on a keyword hit OR a semantic hit above
 * the floor, ranked by the weighted blend. The keyword arm is a case-
 * insensitive substring match over title+content (no tsvector on this table),
 * scored 1 when it matches so the blend still rewards a lexical hit.
 */
async function hybridQuery(
  query: string,
  embedding: number[],
  ceiling: ContentAudience,
  topK: number,
  minScore: number
): Promise<ChangelogRow[]> {
  const vectorStr = `[${embedding.join(',')}]`
  const pattern = `%${query}%`
  const semantic = sql<number>`COALESCE(1 - (${changelogEntries.embedding} <=> ${vectorStr}::vector), 0)`
  const keyword = sql<number>`(CASE WHEN (${changelogEntries.title} ILIKE ${pattern} OR ${changelogEntries.content} ILIKE ${pattern}) THEN 1 ELSE 0 END)`
  const combined = sql<number>`(${CHANGELOG_KEYWORD_WEIGHT} * ${keyword} + ${CHANGELOG_SEMANTIC_WEIGHT} * ${semantic})`

  return db
    .select({
      id: changelogEntries.id,
      title: changelogEntries.title,
      content: trimmedContent(),
      score: combined.as('score'),
      isPublished: isPublished().as('is_published'),
      updatedAt: changelogEntries.updatedAt,
    })
    .from(changelogEntries)
    .where(
      and(
        ...changelogVisibilityConditions(ceiling),
        sql`(
          (${changelogEntries.title} ILIKE ${pattern} OR ${changelogEntries.content} ILIKE ${pattern})
          OR (
            ${changelogEntries.embedding} IS NOT NULL
            AND 1 - (${changelogEntries.embedding} <=> ${vectorStr}::vector) > ${minScore}
          )
        )`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}

/** Keyword-only fallback when embedding generation is unavailable. An ILIKE
 *  hit carries no relevance signal, so its score is 0 (see the summaries
 *  source for why a no-signal row must sort behind genuinely scored items). */
async function keywordQuery(
  query: string,
  ceiling: ContentAudience,
  topK: number
): Promise<ChangelogRow[]> {
  const pattern = `%${query}%`

  return db
    .select({
      id: changelogEntries.id,
      title: changelogEntries.title,
      content: trimmedContent(),
      score: sql<number>`0`.as('score'),
      isPublished: isPublished().as('is_published'),
      updatedAt: changelogEntries.updatedAt,
    })
    .from(changelogEntries)
    .where(
      and(
        ...changelogVisibilityConditions(ceiling),
        sql`(${changelogEntries.title} ILIKE ${pattern} OR ${changelogEntries.content} ILIKE ${pattern})`
      )
    )
    .orderBy(sql`${changelogEntries.publishedAt} DESC NULLS LAST`)
    .limit(topK)
}

/**
 * Retrieve the top-k most relevant changelog entries for a query, scoped to
 * the turn's retrieval ceiling. Semantic when a query embedding is available,
 * keyword (ILIKE) otherwise. Always returns an array; empty means nothing
 * relevant (or visible) was found.
 */
export async function retrieveChangelogEntries(
  query: string,
  ceiling: ContentAudience,
  options: RetrieveChangelogOptions = {}
): Promise<RetrievedChangelogEntry[]> {
  const topK = options.topK ?? CHANGELOG_TOP_K
  const minScore = options.minScore ?? CHANGELOG_SEMANTIC_SIMILARITY_FLOOR

  const embedding = await generateEmbedding(query, {
    pipelineStep: 'assistant_changelog_retrieval_query_embedding',
  })

  const rows = embedding
    ? await hybridQuery(query, embedding, ceiling, topK, minScore)
    : await keywordQuery(query, ceiling, topK)

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content ?? '',
    score: Number(r.score),
    isPublished: r.isPublished,
    updatedAt: r.updatedAt,
  }))
}

/**
 * The changelog `KnowledgeSource`: wraps `retrieveChangelogEntries`, mapping
 * its audience-scoped rows onto `RetrievedItem`. Dynamically imported by
 * `resolveKnowledgeSources` only when `assistantKnowledge` is on.
 */
export const changelogKnowledgeSource: KnowledgeSource = {
  sourceType: 'changelog',
  async retrieve(query, ceiling) {
    const rows = await retrieveChangelogEntries(query, ceiling)
    return rows.map(
      (e): RetrievedItem => ({
        id: e.id,
        sourceType: 'changelog' as const,
        title: e.title,
        excerpt: e.content.slice(0, KNOWLEDGE_SNIPPET_CHARS),
        score: e.score,
        updatedAt: e.updatedAt.toISOString(),
        citation: {
          type: 'changelog' as const,
          id: e.id,
          title: e.title,
          // Published entries link to the public changelog and stay
          // customer-visible; drafts/scheduled entries (only reachable at a
          // team ceiling) link to the admin editor and trip the leak gate.
          url: e.isPublished ? publicChangelogUrl(e.id) : adminChangelogUrl(e.id),
          ...(e.isPublished ? {} : { internal: true }),
        },
      })
    )
  },
}
