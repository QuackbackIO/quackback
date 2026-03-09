/**
 * Signal embedding service.
 *
 * Embeds signal summary + implicitNeed using text-embedding-3-small.
 * Provides similarity search against post embeddings for suggestion generation.
 */

import { UnrecoverableError } from 'bullmq'
import { db, eq, feedbackSignals, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import { EMBEDDING_MODEL } from '@/lib/server/domains/embeddings/embedding.service'
import type { FeedbackSignalId } from '@quackback/ids'

/**
 * Generate and store an embedding for a feedback signal.
 */
export async function embedSignal(signalId: FeedbackSignalId): Promise<number[] | null> {
  const openai = getOpenAI()
  if (!openai) return null

  const signal = await db.query.feedbackSignals.findFirst({
    where: eq(feedbackSignals.id, signalId),
    columns: { summary: true, implicitNeed: true },
  })

  if (!signal) {
    throw new UnrecoverableError(`Signal ${signalId} not found`)
  }

  const textToEmbed = [signal.summary, signal.implicitNeed].filter(Boolean).join(' - ')
  if (!textToEmbed.trim()) return null

  const response = await withRetry(() =>
    openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: textToEmbed.slice(0, 8000),
    })
  )

  const embedding = response.data[0]?.embedding
  if (!embedding) return null

  const vectorStr = `[${embedding.join(',')}]`
  await db
    .update(feedbackSignals)
    .set({
      embedding: sql`${vectorStr}::vector` as any,
      embeddingModel: EMBEDDING_MODEL,
      embeddingUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(feedbackSignals.id, signalId))

  return embedding
}

/**
 * Find similar posts by embedding cosine similarity.
 * Searches against posts.embedding for merge suggestion candidates.
 */
export async function findSimilarPosts(
  embedding: number[],
  opts?: {
    limit?: number
    minSimilarity?: number
    excludePostId?: string
  }
): Promise<
  Array<{
    id: string
    title: string
    voteCount: number
    boardId: string | null
    boardName: string | null
    similarity: number
  }>
> {
  const limit = opts?.limit ?? 10
  const minSimilarity = opts?.minSimilarity ?? 0.7
  const vectorStr = `[${embedding.join(',')}]`

  const excludeClause = opts?.excludePostId ? sql`AND p.id != ${opts.excludePostId}::uuid` : sql``

  const results = await db.execute(sql`
    SELECT
      p.id, p.title, p.vote_count,
      p.board_id, b.name AS board_name,
      1 - (p.embedding <=> ${vectorStr}::vector) AS similarity
    FROM posts p
    LEFT JOIN boards b ON p.board_id = b.id
    WHERE p.embedding IS NOT NULL
      AND p.deleted_at IS NULL
      AND p.moderation_state NOT IN ('deleted', 'spam')
      AND p.canonical_post_id IS NULL
      AND 1 - (p.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
      ${excludeClause}
    ORDER BY p.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `)

  return getExecuteRows<{
    id: string
    title: string
    vote_count: number
    board_id: string | null
    board_name: string | null
    similarity: number
  }>(results).map((r) => ({
    id: r.id,
    title: r.title,
    voteCount: r.vote_count,
    boardId: r.board_id,
    boardName: r.board_name,
    similarity: r.similarity,
  }))
}

/**
 * Find similar pending create_post suggestions by embedding cosine similarity.
 * Used to avoid generating duplicate create_post suggestions when identical
 * feedback arrives before any suggestion has been accepted into a real post.
 */
export async function findSimilarPendingSuggestions(
  embedding: number[],
  opts?: {
    limit?: number
    minSimilarity?: number
    excludeRawItemId?: string
  }
): Promise<
  Array<{
    id: string
    rawFeedbackItemId: string
    suggestedTitle: string | null
    boardId: string | null
    similarity: number
  }>
> {
  const limit = opts?.limit ?? 5
  const minSimilarity = opts?.minSimilarity ?? 0.7
  const vectorStr = `[${embedding.join(',')}]`

  const excludeClause = opts?.excludeRawItemId
    ? sql`AND fs.raw_feedback_item_id != ${opts.excludeRawItemId}::uuid`
    : sql``

  const results = await db.execute(sql`
    SELECT
      fs.id,
      fs.raw_feedback_item_id,
      fs.suggested_title,
      fs.board_id,
      1 - (fs.embedding <=> ${vectorStr}::vector) AS similarity
    FROM feedback_suggestions fs
    WHERE fs.embedding IS NOT NULL
      AND fs.status = 'pending'
      AND fs.suggestion_type = 'create_post'
      AND 1 - (fs.embedding <=> ${vectorStr}::vector) >= ${minSimilarity}
      ${excludeClause}
    ORDER BY fs.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `)

  return getExecuteRows<{
    id: string
    raw_feedback_item_id: string
    suggested_title: string | null
    board_id: string | null
    similarity: number
  }>(results).map((r) => ({
    id: r.id,
    rawFeedbackItemId: r.raw_feedback_item_id,
    suggestedTitle: r.suggested_title,
    boardId: r.board_id,
    similarity: r.similarity,
  }))
}
