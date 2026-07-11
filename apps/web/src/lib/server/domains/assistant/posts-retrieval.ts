/**
 * Feedback-posts grounding source for Quinn.
 *
 * A second `KnowledgeSource` (see `./retrieval-sources`) alongside the
 * knowledge base: retrieval over `posts`, same audience-scoped hybrid shape as
 * `retrieveKbArticles` (retrieval.ts) — semantic (pgvector cosine over
 * `posts.embedding`) blended with tsvector (`posts.searchVector`) when a
 * query embedding is available, keyword-only otherwise. Registered only
 * behind the `assistantPostGrounding` flag (see `resolveKnowledgeSources`),
 * default off.
 *
 * Changelog entries have no tsvector or embedding today, so they are not a
 * grounding source yet — deferred, not in scope here.
 */
import { db, posts, boards, and, eq, isNull, sql } from '@/lib/server/db'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { orTermsTsQuery } from '@/lib/server/domains/help-center/help-center-search.service'
import type { ContentAudience } from './audience'
import {
  KNOWLEDGE_SNIPPET_CHARS,
  type KnowledgeSource,
  type RetrievedItem,
} from './retrieval-sources'

/** Blend weights for the hybrid score. Mirrors the KB retrieval tuning
 *  (help-center-search.service.ts KEYWORD_WEIGHT/SEMANTIC_WEIGHT) but kept as
 *  its own constants — the two corpora may need to diverge as usage data
 *  comes in, and posts have no shared owner with the help center. */
export const POSTS_KEYWORD_WEIGHT = 0.4
export const POSTS_SEMANTIC_WEIGHT = 0.6

/** Cosine-similarity floor for the semantic arm. Rows below it are absent. */
export const POSTS_SEMANTIC_SIMILARITY_FLOOR = 0.35

/** ts_rank floor for the keyword arm (OR-of-terms otherwise admits a lone
 *  incidental term). */
export const POSTS_KEYWORD_RANK_FLOOR = 0.3

/** Default number of posts retrieved per query. */
export const POSTS_ASK_TOP_K = 5

/** Per-post content budget for the retrieval context (trimmed in SQL). */
export const POSTS_ASK_CONTEXT_CHARS = 4000

export interface RetrievedPost {
  id: string
  title: string
  content: string
  boardSlug: string
  score: number
  /** Whether the post's board is anonymous-viewable: the same predicate the
   *  'public' branch of {@link postsVisibilityConditions} enforces at query
   *  time, exposed per row so a wider ('team'/'internal') query can tell a
   *  publicly-viewable post apart from one on a private board. */
  isPublic: boolean
  /** The row's last-update timestamp, for the copilot citation freshness line
   *  (see RetrievedItem.updatedAt in retrieval-sources.ts). */
  updatedAt: Date
}

export interface RetrievePostsOptions {
  topK?: number
  minScore?: number
  keywordRankFloor?: number
}

/** Public portal path for a retrieved post. */
function postUrl(boardSlug: string, postId: string): string {
  return `/b/${boardSlug}/posts/${postId}`
}

/**
 * THE visibility predicate for posts retrieved as assistant grounding,
 * parameterized by the turn's retrieval ceiling. Every post query in this
 * module builds its predicate from this single owner, or a post hidden on
 * one ceiling could become discoverable through another.
 *
 * Always excludes soft-deleted posts, merged posts (a duplicate points at its
 * canonical post via `canonicalPostId`; only the canonical post should ever
 * be cited), non-published moderation states, and posts whose board is
 * itself soft-deleted.
 *
 * Board visibility beyond that is scoped by the ceiling: a `public` ceiling
 * (the customer-facing surfaces) only sees posts on a publicly-viewable board
 * — the same `access.view === 'anonymous'` JSONB check as the `anonymous`
 * branch of `policy/boards.ts#boardViewFilter` — so a post on a
 * non-public board (authenticated/segments/team) can never reach a
 * public-ceiling caller. A `team`/`internal` ceiling (the copilot surface)
 * sees posts on any (non-deleted) board, mirroring `isTeamActor` bypassing
 * the access matrix there.
 */
export function postsVisibilityConditions(ceiling: ContentAudience) {
  const base = [
    isNull(posts.deletedAt),
    isNull(posts.canonicalPostId),
    eq(posts.moderationState, 'published'),
    isNull(boards.deletedAt),
  ]
  if (ceiling === 'public') {
    return [...base, sql`${boards.access}->>'view' = 'anonymous'`]
  }
  return base
}

/** Select the post content pre-trimmed to the context budget. */
const trimmedContent = () => sql<string>`left(${posts.content}, ${POSTS_ASK_CONTEXT_CHARS})`

/** The same anonymous-viewable check the 'public' branch of
 *  {@link postsVisibilityConditions} filters on, computed per row. */
const isPublicBoard = () => sql<boolean>`(${boards.access}->>'view' = 'anonymous')`

interface PostRetrievalRow {
  id: string
  title: string
  content: string
  boardSlug: string
  score: number
  isPublic: boolean
  updatedAt: Date
}

/**
 * Hybrid retrieval: a post matches on a keyword hit OR a semantic hit above
 * the floor, ranked by the weighted blend of both. Mirrors
 * retrieval.ts#hybridQuery.
 */
async function hybridQuery(
  query: string,
  embedding: number[],
  ceiling: ContentAudience,
  topK: number,
  minScore: number,
  rankFloor: number
): Promise<PostRetrievalRow[]> {
  const vectorStr = `[${embedding.join(',')}]`
  const tsQuery = orTermsTsQuery(query)
  const semantic = sql<number>`COALESCE(1 - (${posts.embedding} <=> ${vectorStr}::vector), 0)`
  const keyword = sql<number>`COALESCE(ts_rank(${posts.searchVector}, ${tsQuery}), 0)`
  const combined = sql<number>`(${POSTS_KEYWORD_WEIGHT} * ${keyword} + ${POSTS_SEMANTIC_WEIGHT} * ${semantic})`

  return db
    .select({
      id: posts.id,
      title: posts.title,
      content: trimmedContent(),
      boardSlug: boards.slug,
      score: combined.as('score'),
      isPublic: isPublicBoard().as('is_public_board'),
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(
        ...postsVisibilityConditions(ceiling),
        sql`(
          (
            ${posts.searchVector} @@ ${tsQuery}
            AND ts_rank(${posts.searchVector}, ${tsQuery}) > ${rankFloor}
          )
          OR (
            ${posts.embedding} IS NOT NULL
            AND 1 - (${posts.embedding} <=> ${vectorStr}::vector) > ${minScore}
          )
        )`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}

/** Keyword-only fallback when embedding generation is unavailable. */
async function keywordQuery(
  query: string,
  ceiling: ContentAudience,
  topK: number,
  rankFloor: number
): Promise<PostRetrievalRow[]> {
  const tsQuery = orTermsTsQuery(query)
  const rank = sql<number>`ts_rank(${posts.searchVector}, ${tsQuery})`

  return db
    .select({
      id: posts.id,
      title: posts.title,
      content: trimmedContent(),
      boardSlug: boards.slug,
      score: rank.as('score'),
      isPublic: isPublicBoard().as('is_public_board'),
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .innerJoin(boards, eq(posts.boardId, boards.id))
    .where(
      and(
        ...postsVisibilityConditions(ceiling),
        sql`${posts.searchVector} @@ ${tsQuery}`,
        sql`ts_rank(${posts.searchVector}, ${tsQuery}) > ${rankFloor}`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}

/**
 * Retrieve the top-k most relevant feedback posts for a query, scoped to the
 * turn's retrieval ceiling. Mirrors `retrieveKbArticles`'s two-path shape:
 * semantic when a query embedding is available, keyword (tsvector) otherwise.
 * Always returns an array; empty means nothing relevant (or visible) was
 * found.
 */
export async function retrievePosts(
  query: string,
  ceiling: ContentAudience,
  options: RetrievePostsOptions = {}
): Promise<RetrievedPost[]> {
  const topK = options.topK ?? POSTS_ASK_TOP_K
  const minScore = options.minScore ?? POSTS_SEMANTIC_SIMILARITY_FLOOR
  const keywordRankFloor = options.keywordRankFloor ?? POSTS_KEYWORD_RANK_FLOOR

  const embedding = await generateEmbedding(query, {
    pipelineStep: 'assistant_posts_retrieval_query_embedding',
  })

  const rows = embedding
    ? await hybridQuery(query, embedding, ceiling, topK, minScore, keywordRankFloor)
    : await keywordQuery(query, ceiling, topK, keywordRankFloor)

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content ?? '',
    boardSlug: r.boardSlug,
    score: Number(r.score),
    isPublic: r.isPublic,
    updatedAt: r.updatedAt,
  }))
}

/**
 * The feedback-posts `KnowledgeSource`: wraps `retrievePosts`, mapping its
 * audience-scoped rows onto `RetrievedItem`. Dynamically imported by
 * `resolveKnowledgeSources` only when `assistantPostGrounding` is on.
 */
export const postsKnowledgeSource: KnowledgeSource = {
  sourceType: 'post',
  async retrieve(query, ceiling) {
    const rows = await retrievePosts(query, ceiling)
    return rows.map(
      (p): RetrievedItem => ({
        id: p.id,
        sourceType: 'post' as const,
        title: p.title,
        excerpt: p.content.slice(0, KNOWLEDGE_SNIPPET_CHARS),
        score: p.score,
        updatedAt: p.updatedAt.toISOString(),
        citation: {
          type: 'post' as const,
          id: p.id,
          title: p.title,
          url: postUrl(p.boardSlug, p.id),
          // Public at the 'public' ceiling is guaranteed by
          // postsVisibilityConditions; on 'team'/'internal' this flags a post
          // on a non-anonymous-viewable board for the copilot leak gate.
          ...(p.isPublic ? {} : { internal: true }),
        },
      })
    )
  },
}
