/**
 * AI hook handler.
 *
 * Processes AI features (sentiment analysis, embeddings) for new posts.
 * Runs on post.created events to analyze and index content.
 */

import type { HookHandler, HookResult } from '../hook-types'
import type { EventData } from '../types'
import { isAIEnabled } from '@/lib/ai/config'
import { analyzeSentiment, saveSentiment } from '@/lib/sentiment'
import { generatePostEmbedding } from '@/lib/embeddings'
import type { PostId } from '@quackback/ids'
import { db, postTags, tags, eq } from '@/lib/db'

/**
 * AI hook handler - processes sentiment and embeddings for new posts.
 * Event type filtering is handled by targets.ts, so we only receive post.created events.
 */
export const aiHook: HookHandler = {
  async run(event: EventData, _target: unknown, _config: unknown): Promise<HookResult> {
    if (!isAIEnabled()) {
      console.log('[AI] Skipping: OPENAI_API_KEY not configured')
      return { success: true }
    }

    const { post } = event.data as { post: { id: string; title: string; content: string } }
    const postId = post.id as PostId
    console.log(`[AI] Processing post: ${postId}`)

    // Run sentiment and embedding in parallel
    const [sentimentResult, embeddingResult] = await Promise.allSettled([
      processSentiment(postId, post.title, post.content),
      processEmbedding(postId, post.title, post.content),
    ])

    const sentimentOk = sentimentResult.status === 'fulfilled' && sentimentResult.value
    const embeddingOk = embeddingResult.status === 'fulfilled' && embeddingResult.value

    // Log any failures
    if (sentimentResult.status === 'rejected') {
      console.error(`[AI] Sentiment failed for ${postId}:`, sentimentResult.reason)
    }
    if (embeddingResult.status === 'rejected') {
      console.error(`[AI] Embedding failed for ${postId}:`, embeddingResult.reason)
    }

    console.log(`[AI] ${postId}: sentiment=${sentimentOk}, embedding=${embeddingOk}`)

    return { success: true }
  },
}

/**
 * Process sentiment analysis for a post.
 */
async function processSentiment(postId: PostId, title: string, content: string): Promise<boolean> {
  const result = await analyzeSentiment(title, content)
  if (!result) return false

  await saveSentiment(postId, result)
  console.log(`[Sentiment] ${postId} -> ${result.sentiment}`)
  return true
}

/**
 * Fetch tag names for a post.
 * Used to include tags in embedding text for better semantic matching.
 */
async function getPostTagNames(postId: PostId): Promise<string[]> {
  try {
    const result = await db
      .select({ name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(postTags.tagId, tags.id))
      .where(eq(postTags.postId, postId))

    return result.map((r) => r.name)
  } catch (error) {
    console.warn(`[AI] Failed to fetch tags for ${postId}:`, error)
    return []
  }
}

/**
 * Process embedding generation for a post.
 */
async function processEmbedding(postId: PostId, title: string, content: string): Promise<boolean> {
  // Fetch tags to include in embedding for better semantic matching
  const tagNames = await getPostTagNames(postId)
  if (tagNames.length > 0) {
    console.log(`[Embedding] Including ${tagNames.length} tags: ${tagNames.join(', ')}`)
  }

  const success = await generatePostEmbedding(postId, title, content, tagNames)
  if (success) {
    console.log(`[Embedding] ${postId}`)
  }
  return success
}
