/**
 * Merge search service — hybrid vector + FTS search for merge candidates.
 *
 * Replicates the pattern from public-posts.ts findSimilarPostsFn:
 * parallel vector + FTS queries, score merging, hybrid threshold filtering.
 */

import { db, posts, and, isNull, desc, sql } from '@/lib/server/db'
import type { PostId } from '@quackback/ids'

export interface MergeCandidate {
  postId: PostId
  title: string
  content: string
  voteCount: number
  commentCount: number
  createdAt: Date
  vectorScore: number
  ftsScore: number
  hybridScore: number
}

const VECTOR_THRESHOLD = 0.35
const HYBRID_THRESHOLD = 0.4
const FTS_WEIGHT = 0.3
const DEFAULT_LIMIT = 5

/**
 * Find merge candidates for a post using hybrid vector + FTS search.
 */
export async function findMergeCandidates(
  postId: PostId,
  opts?: { limit?: number; sourcePost?: { title: string; embedding: unknown } }
): Promise<MergeCandidate[]> {
  const limit = opts?.limit ?? DEFAULT_LIMIT
  const fetchLimit = limit * 2

  // Use provided source post data or fetch from DB
  const sourcePost =
    opts?.sourcePost ??
    (await db.query.posts.findFirst({
      where: (p, { eq }) => eq(p.id, postId),
      columns: { title: true, embedding: true },
    }))

  if (!sourcePost?.embedding) {
    return []
  }

  const embedding = sourcePost.embedding
  const title = sourcePost.title

  // Run vector + FTS searches in parallel
  const vectorStr = `[${(embedding as unknown as string).replace(/^\[|\]$/g, '')}]`

  const ftsPromise = db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      voteCount: posts.voteCount,
      commentCount: posts.commentCount,
      createdAt: posts.createdAt,
      score: sql<number>`ts_rank(${posts.searchVector}, plainto_tsquery('english', ${title}))`.as(
        'fts_score'
      ),
    })
    .from(posts)
    .where(
      and(
        isNull(posts.deletedAt),
        isNull(posts.canonicalPostId),
        sql`${posts.embedding} IS NOT NULL`,
        sql`${posts.id} != ${postId}`,
        sql`${posts.searchVector} @@ plainto_tsquery('english', ${title})`
      )
    )
    .orderBy(desc(sql`ts_rank(${posts.searchVector}, plainto_tsquery('english', ${title}))`))
    .limit(fetchLimit)

  const vectorPromise = db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      voteCount: posts.voteCount,
      commentCount: posts.commentCount,
      createdAt: posts.createdAt,
      score: sql<number>`1 - (${posts.embedding} <=> ${vectorStr}::vector)`.as('vec_score'),
    })
    .from(posts)
    .where(
      and(
        isNull(posts.deletedAt),
        isNull(posts.canonicalPostId),
        sql`${posts.embedding} IS NOT NULL`,
        sql`${posts.id} != ${postId}`,
        sql`1 - (${posts.embedding} <=> ${vectorStr}::vector) >= ${VECTOR_THRESHOLD}`
      )
    )
    .orderBy(desc(sql`1 - (${posts.embedding} <=> ${vectorStr}::vector)`))
    .limit(fetchLimit)

  const [ftsMatches, vectorMatches] = await Promise.all([ftsPromise, vectorPromise])

  // Merge results, deduplicate by post ID, combine scores
  const scoreMap = new Map<
    string,
    {
      postId: PostId
      title: string
      content: string
      voteCount: number
      commentCount: number
      createdAt: Date
      vectorScore: number
      ftsScore: number
    }
  >()

  for (const r of vectorMatches) {
    scoreMap.set(r.id, {
      postId: r.id,
      title: r.title,
      content: r.content,
      voteCount: r.voteCount,
      commentCount: r.commentCount,
      createdAt: r.createdAt,
      vectorScore: Number(r.score),
      ftsScore: 0,
    })
  }

  for (const r of ftsMatches) {
    const normalizedFts = Math.min(Number(r.score) * 2, 1)
    const existing = scoreMap.get(r.id)
    if (existing) {
      existing.ftsScore = normalizedFts
    } else {
      scoreMap.set(r.id, {
        postId: r.id,
        title: r.title,
        content: r.content,
        voteCount: r.voteCount,
        commentCount: r.commentCount,
        createdAt: r.createdAt,
        vectorScore: 0,
        ftsScore: normalizedFts,
      })
    }
  }

  // Calculate hybrid scores and filter
  const candidates: MergeCandidate[] = Array.from(scoreMap.values())
    .map((entry) => {
      const hybridScore =
        entry.ftsScore > 0
          ? Math.min(entry.vectorScore + entry.ftsScore * FTS_WEIGHT, 1)
          : entry.vectorScore
      return { ...entry, hybridScore }
    })
    .filter((c) => c.hybridScore >= HYBRID_THRESHOLD)
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, limit)

  return candidates
}
