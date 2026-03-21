/**
 * Signal embedding service.
 *
 * Embeds signals in a format mirroring post embeddings (formatPostText) for accurate similarity.
 * Provides similarity search against post embeddings for suggestion generation.
 */

import { UnrecoverableError } from 'bullmq'
import { db, eq, feedbackSignals, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import {
  generateEmbedding,
  EMBEDDING_MODEL,
} from '@/lib/server/domains/embeddings/embedding.service'
import { toUuid, type FeedbackSignalId } from '@quackback/ids'

/**
 * Generate and store an embedding for a feedback signal.
 */
export async function embedSignal(
  signalId: FeedbackSignalId,
  rawFeedbackItemId?: string
): Promise<number[] | null> {
  const signal = await db.query.feedbackSignals.findFirst({
    where: eq(feedbackSignals.id, signalId),
    columns: { summary: true, implicitNeed: true, evidence: true },
  })

  if (!signal) {
    throw new UnrecoverableError(`Signal ${signalId} not found`)
  }

  // Mirror the post embedding format (formatPostText) for accurate cosine similarity:
  //   Posts embed as: title \n\n title \n\n content \n\n Tags: ...
  // So signals embed as: summary \n\n summary \n\n implicitNeed \n\n evidence...
  //
  // - Summary repeated for title-weight parity with posts
  // - \n\n separator matches formatPostText
  // - Evidence quotes (original customer words) bridge vocabulary gap
  //   between abstract LLM summaries and natural post content
  const evidence = (signal.evidence as string[] | null) ?? []
  const textToEmbed = [signal.summary, signal.summary, signal.implicitNeed, ...evidence]
    .filter(Boolean)
    .join('\n\n')
  if (!textToEmbed.trim()) return null

  const embedding = await generateEmbedding(textToEmbed, {
    pipelineStep: 'signal_embedding',
    rawFeedbackItemId,
    signalId,
  })
  if (!embedding) return null

  const vectorStr = `[${embedding.join(',')}]`
  await db
    .update(feedbackSignals)
    .set({
      embedding: sql<number[]>`${vectorStr}::vector`,
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

  const excludeClause = opts?.excludePostId
    ? sql`AND p.id != ${toUuid(opts.excludePostId)}::uuid`
    : sql``

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
    ? sql`AND fs.raw_feedback_item_id != ${toUuid(opts.excludeRawItemId)}::uuid`
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
