/**
 * AI hook handler.
 *
 * Processes AI features (sentiment analysis, embeddings) for new posts.
 * Runs on post.created events to analyze and index content.
 */

import type { HookHandler, HookResult, HookRunContext } from '../hook-types'
import type { EventData } from '../types'
import { analyzeSentiment, saveSentiment } from '@/lib/server/domains/sentiment/sentiment.service'
import { generatePostEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import type { PostId } from '@quackback/ids'
import { db, postTagAssignments, tags, eq } from '@/lib/server/db'
import { claimHookDelivery } from '../hook-idempotency'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ai' })

/**
 * AI hook handler - processes sentiment and embeddings for new posts.
 * Event type filtering is handled by targets.ts, so we only receive post.created events.
 */
export const aiHook: HookHandler = {
  async run(
    event: EventData,
    _target: unknown,
    _config: unknown,
    ctx?: HookRunContext
  ): Promise<HookResult> {
    const { post } = event.data as { post: { id: string; title: string; content: string } }
    const postId = post.id as PostId

    // Idempotency: if BullMQ is re-running this job after a worker crash,
    // skip the analysis — the previous attempt already paid OpenAI for
    // sentiment + embedding work. Without this, every rolling restart
    // that interrupts the AI worker double-bills.
    const claimed = await claimHookDelivery(ctx?.jobId, 'ai')
    if (!claimed) {
      log.debug({ job_id: ctx?.jobId, post_id: postId }, 'skipping duplicate processing')
      return { success: true }
    }

    log.debug({ post_id: postId }, 'processing post')

    // Run sentiment and embedding in parallel
    const [sentimentResult, embeddingResult] = await Promise.allSettled([
      processSentiment(postId, post.title, post.content),
      processEmbedding(postId, post.title, post.content),
    ])

    const sentimentOk = sentimentResult.status === 'fulfilled' && sentimentResult.value
    const embeddingOk = embeddingResult.status === 'fulfilled' && embeddingResult.value

    // Log any failures
    if (sentimentResult.status === 'rejected') {
      log.error({ err: sentimentResult.reason, post_id: postId }, 'sentiment failed')
    }
    if (embeddingResult.status === 'rejected') {
      log.error({ err: embeddingResult.reason, post_id: postId }, 'embedding failed')
    }

    log.info(
      { post_id: postId, sentiment_ok: sentimentOk, embedding_ok: embeddingOk },
      'post analysis complete'
    )

    return { success: true }
  },
}

/**
 * Process sentiment analysis for a post.
 */
async function processSentiment(postId: PostId, title: string, content: string): Promise<boolean> {
  const result = await analyzeSentiment(title, content, postId)
  if (!result) return false

  await saveSentiment(postId, result)
  log.debug({ post_id: postId, sentiment: result.sentiment }, 'sentiment saved')
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
      .from(postTagAssignments)
      .innerJoin(tags, eq(postTagAssignments.tagId, tags.id))
      .where(eq(postTagAssignments.postId, postId))

    return result.map((r) => r.name)
  } catch (error) {
    log.warn({ err: error, post_id: postId }, 'failed to fetch tags')
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
    log.debug(
      { post_id: postId, tag_count: tagNames.length, tags: tagNames },
      'including tags in embedding'
    )
  }

  const success = await generatePostEmbedding(postId, title, content, tagNames)
  if (success) {
    log.debug({ post_id: postId }, 'embedding generated')
  }
  return success
}
