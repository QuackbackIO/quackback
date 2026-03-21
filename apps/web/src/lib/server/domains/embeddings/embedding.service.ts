/**
 * Embedding service for semantic similarity search.
 *
 * Generates embeddings using OpenAI text-embedding-3-small.
 * Used for finding similar posts and duplicate detection.
 */

import { db, posts, eq, and, isNull, sql, desc, ne } from '@/lib/server/db'
import type { PostId, BoardId } from '@quackback/ids'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { withRetry } from '@/lib/server/domains/ai/retry'
import { withUsageLogging } from '@/lib/server/domains/ai/usage-log'

export const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536

/**
 * Generate embedding for text using OpenAI.
 * When logContext is provided, usage is recorded to ai_usage_log.
 */
export async function generateEmbedding(
  text: string,
  logContext?: {
    pipelineStep: string
    postId?: string
    rawFeedbackItemId?: string
    signalId?: string
  }
): Promise<number[] | null> {
  const openai = getOpenAI()
  if (!openai) return null

  // Truncate to avoid token limits (8191 tokens for text-embedding-3-small)
  const truncated = text.slice(0, 8000)

  try {
    if (logContext) {
      const response = await withUsageLogging(
        {
          pipelineStep: logContext.pipelineStep,
          callType: 'embedding',
          model: EMBEDDING_MODEL,
          postId: logContext.postId,
          rawFeedbackItemId: logContext.rawFeedbackItemId,
          signalId: logContext.signalId,
        },
        () =>
          withRetry(() =>
            openai.embeddings.create({
              model: EMBEDDING_MODEL,
              input: truncated,
              dimensions: EMBEDDING_DIMENSIONS,
            })
          ),
        (r) => ({
          inputTokens: r.usage?.prompt_tokens ?? 0,
          totalTokens: r.usage?.total_tokens ?? 0,
        })
      )
      return response.data[0]?.embedding ?? null
    }

    const { result: response } = await withRetry(() =>
      openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: truncated,
        dimensions: EMBEDDING_DIMENSIONS,
      })
    )
    return response.data[0]?.embedding ?? null
  } catch (error) {
    console.error(
      `[Embedding] OpenAI failed for ${logContext?.pipelineStep ?? 'unknown'} (post=${logContext?.postId ?? 'n/a'}):`,
      error
    )
    return null
  }
}

/**
 * Generate and format embedding text from post title, content, and tags.
 * Title is repeated for emphasis (higher weight in similarity).
 * Tags are included to improve semantic matching on categorization.
 */
export function formatPostText(title: string, content: string, tags?: string[]): string {
  const parts = [title, title, content || '']

  // Include tags as additional context for better semantic matching
  // This helps with synonym detection (e.g., "dark mode" matches "theme" tag)
  if (tags && tags.length > 0) {
    parts.push(`Tags: ${tags.join(', ')}`)
  }

  return parts.join('\n\n')
}

/**
 * Generate embedding for a post and save it to the database.
 * @param postId - The post ID
 * @param title - Post title
 * @param content - Post content
 * @param tags - Optional array of tag names to include in embedding
 */
export async function generatePostEmbedding(
  postId: PostId,
  title: string,
  content: string,
  tags?: string[]
): Promise<boolean> {
  const text = formatPostText(title, content, tags)
  const embedding = await generateEmbedding(text, {
    pipelineStep: 'post_embedding',
    postId,
  })

  if (!embedding) {
    console.error(`[Embedding] Failed to generate for post ${postId}`)
    return false
  }

  await savePostEmbedding(postId, embedding)

  // Fire-and-forget: check for merge candidates now that embedding is fresh
  import('@/lib/server/domains/merge-suggestions/merge-check.service')
    .then(({ checkPostForMergeCandidates }) => checkPostForMergeCandidates(postId))
    .catch((err) => console.error(`[Embedding] Merge check failed for ${postId}:`, err))

  return true
}

/**
 * Save embedding to post record.
 */
export async function savePostEmbedding(postId: PostId, embedding: number[]): Promise<void> {
  // pgvector expects array format: [0.1, 0.2, ...]
  const vectorStr = `[${embedding.join(',')}]`

  await db
    .update(posts)
    .set({
      embedding: sql<number[]>`${vectorStr}::vector`,
      embeddingModel: EMBEDDING_MODEL,
      embeddingUpdatedAt: new Date(),
      mergeCheckedAt: null,
    })
    .where(eq(posts.id, postId))
}

type SimilarPostResult = { id: PostId; title: string; similarity: number }

interface SimilaritySearchOptions {
  boardId: BoardId
  excludePostId?: PostId
  limit?: number
  threshold?: number
}

/**
 * Execute vector similarity search with the given embedding.
 */
async function searchByEmbedding(
  embedding: number[],
  options: SimilaritySearchOptions
): Promise<SimilarPostResult[]> {
  const { boardId, excludePostId, limit = 5, threshold = 0.7 } = options
  const vectorStr = `[${embedding.join(',')}]`

  const conditions = [
    eq(posts.boardId, boardId),
    isNull(posts.deletedAt),
    sql`${posts.embedding} IS NOT NULL`,
    sql`1 - (${posts.embedding} <=> ${vectorStr}::vector) >= ${threshold}`,
  ]

  if (excludePostId) {
    conditions.push(ne(posts.id, excludePostId))
  }

  const results = await db
    .select({
      id: posts.id,
      title: posts.title,
      similarity: sql<number>`1 - (${posts.embedding} <=> ${vectorStr}::vector)`.as('similarity'),
    })
    .from(posts)
    .where(and(...conditions))
    .orderBy(desc(sql`1 - (${posts.embedding} <=> ${vectorStr}::vector)`))
    .limit(limit)

  return results.map((r) => ({
    id: r.id,
    title: r.title,
    similarity: Number(r.similarity),
  }))
}

/**
 * Find similar posts using vector similarity search.
 *
 * @param postId - Post to find similarities for (excluded from results)
 * @param boardId - Board to search within
 * @param limit - Maximum number of results
 * @param threshold - Minimum similarity threshold (0-1, cosine similarity)
 */
export async function findSimilarPosts(
  postId: PostId,
  boardId: BoardId,
  limit = 5,
  threshold = 0.7
): Promise<SimilarPostResult[]> {
  const sourcePost = await db.query.posts.findFirst({
    where: eq(posts.id, postId),
    columns: { embedding: true },
  })

  if (!sourcePost?.embedding) {
    return []
  }

  return searchByEmbedding(sourcePost.embedding as number[], {
    boardId,
    excludePostId: postId,
    limit,
    threshold,
  })
}

/**
 * Find similar posts by text (for draft/new post suggestions).
 *
 * @param text - Text to search for
 * @param boardId - Board to search within
 * @param limit - Maximum number of results
 * @param threshold - Minimum similarity threshold (0-1)
 */
export async function findSimilarPostsByText(
  text: string,
  boardId: BoardId,
  limit = 5,
  threshold = 0.7
): Promise<SimilarPostResult[]> {
  const embedding = await generateEmbedding(text)
  if (!embedding) return []

  return searchByEmbedding(embedding, { boardId, limit, threshold })
}

/**
 * Get posts without embeddings.
 */
export async function getPostsWithoutEmbeddings(limit = 100) {
  return db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
    })
    .from(posts)
    .where(and(sql`${posts.embedding} IS NULL`, isNull(posts.deletedAt)))
    .limit(limit)
}
