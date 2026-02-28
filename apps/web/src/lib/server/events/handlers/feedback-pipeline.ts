/**
 * Feedback pipeline hook handler.
 *
 * Ingests new posts into the feedback aggregation pipeline.
 * Fires on post.created events.
 *
 * Customer-only comments are included as thread context for the LLM.
 */

import type { HookHandler, HookResult } from '../hook-types'
import type { EventData, PostCreatedEvent } from '../types'
import { db, eq, feedbackSources } from '@/lib/server/db'
import { getCommentsByPost } from '@/lib/server/domains/comments/comment.service'
import { ingestRawFeedback } from '@/lib/server/domains/feedback/ingestion/feedback-ingest.service'
import type { FeedbackSourceId, PostId } from '@quackback/ids'
import type { RawFeedbackThreadMessage } from '@/lib/server/db'

// Module-level cache for the quackback source ID.
// Set on first hook execution. `null` means no enabled source found.
let cachedSourceId: FeedbackSourceId | null | undefined = undefined

async function getQuackbackSourceId(): Promise<FeedbackSourceId | null> {
  if (cachedSourceId !== undefined) return cachedSourceId

  const source = await db.query.feedbackSources.findFirst({
    where: eq(feedbackSources.sourceType, 'quackback'),
    columns: { id: true, enabled: true },
  })

  cachedSourceId = source?.enabled ? (source.id as FeedbackSourceId) : null
  return cachedSourceId
}

/** Reset the cached source ID (e.g. after source creation on startup). */
export function resetQuackbackSourceCache(): void {
  cachedSourceId = undefined
}

/** Flatten threaded comments, keeping only customer (non-team) comments. */
function collectCustomerMessages(
  threads: {
    id: string
    isTeamMember: boolean
    authorName: string | null
    createdAt: Date | string
    content: string
    replies?: unknown[]
  }[]
): RawFeedbackThreadMessage[] {
  const messages: RawFeedbackThreadMessage[] = []
  for (const thread of threads) {
    if (!thread.isTeamMember) {
      messages.push({
        id: thread.id,
        authorName: thread.authorName ?? undefined,
        role: 'customer',
        sentAt:
          thread.createdAt instanceof Date
            ? thread.createdAt.toISOString()
            : String(thread.createdAt),
        text: thread.content,
      })
    }
    if (Array.isArray(thread.replies)) {
      messages.push(...collectCustomerMessages(thread.replies as typeof threads))
    }
  }
  return messages
}

export const feedbackPipelineHook: HookHandler = {
  async run(event: EventData, _target: unknown, _config: unknown): Promise<HookResult> {
    if (event.type !== 'post.created') return { success: true }

    const { post: eventPost } = (event as PostCreatedEvent).data

    // Source guard: quackback source must exist and be enabled
    const sourceId = await getQuackbackSourceId()
    if (!sourceId) {
      return { success: true }
    }

    // Load customer-only comments for thread context.
    // For brand new posts this will be empty - the post content itself
    // is the primary feedback signal.
    let threadMessages: RawFeedbackThreadMessage[] = []
    try {
      const comments = await getCommentsByPost(eventPost.id as PostId)
      threadMessages = collectCustomerMessages(comments)
    } catch (err) {
      // Comments are best-effort context - ingest without them on failure
      console.warn(`[FeedbackPipeline] Failed to load comments for ${eventPost.id}:`, err)
    }

    await ingestRawFeedback(
      {
        externalId: `post:${eventPost.id}`,
        sourceCreatedAt: new Date(),
        author: {
          principalId: event.actor.principalId,
          email: event.actor.type === 'user' ? event.actor.email : eventPost.authorEmail,
          name: eventPost.authorName,
        },
        content: {
          subject: eventPost.title,
          text: eventPost.content,
        },
        contextEnvelope: {
          ...(threadMessages.length > 0 && { thread: threadMessages }),
          metadata: {
            voteCount: eventPost.voteCount,
            boardSlug: eventPost.boardSlug,
          },
        },
      },
      {
        sourceId,
        sourceType: 'quackback',
      }
    )

    console.log(`[FeedbackPipeline] Ingested post ${eventPost.id}`)
    return { success: true }
  },
}
