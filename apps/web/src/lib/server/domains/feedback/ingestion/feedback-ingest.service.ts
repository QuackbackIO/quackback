/**
 * Feedback ingestion service.
 *
 * Receives raw feedback seeds, deduplicates, inserts raw items,
 * resolves authors, and enqueues for AI processing.
 */

import { db, eq, and, rawFeedbackItems } from '@/lib/server/db'
import type { FeedbackSourceId } from '@quackback/ids'
import { isAIEnabled } from '@/lib/server/domains/ai/config'
import { enqueueFeedbackIngestJob } from '../queues/feedback-ingest-queue'
import { enqueueFeedbackAiJob } from '../queues/feedback-ai-queue'
import { resolveAuthorPrincipal } from './author-resolver'
import type { RawFeedbackSeed } from '../types'
import type { FeedbackSourceType } from '@/lib/server/integrations/feedback-source-types'

interface IngestContext {
  sourceId: FeedbackSourceId
  sourceType: FeedbackSourceType
}

/**
 * Ingest a raw feedback item from any source.
 * Deduplicates by (sourceId, dedupeKey), inserts the raw item,
 * and enqueues context enrichment.
 */
export async function ingestRawFeedback(
  seed: RawFeedbackSeed,
  context: IngestContext
): Promise<{ rawItemId: string; deduplicated: boolean }> {
  const dedupeKey = `${context.sourceType}:${seed.externalId}`

  // Check for existing item (idempotent ingestion)
  const existing = await db.query.rawFeedbackItems.findFirst({
    where: and(
      eq(rawFeedbackItems.sourceId, context.sourceId),
      eq(rawFeedbackItems.dedupeKey, dedupeKey)
    ),
    columns: { id: true },
  })

  if (existing) {
    return { rawItemId: existing.id, deduplicated: true }
  }

  // Insert new raw feedback item
  const [inserted] = await db
    .insert(rawFeedbackItems)
    .values({
      sourceId: context.sourceId,
      sourceType: context.sourceType,
      externalId: seed.externalId,
      dedupeKey,
      externalUrl: seed.externalUrl,
      sourceCreatedAt: seed.sourceCreatedAt,
      author: seed.author,
      content: seed.content,
      contextEnvelope: seed.contextEnvelope ?? {},
      processingState: 'pending_context',
    })
    .returning({ id: rawFeedbackItems.id })

  // Enqueue context enrichment
  await enqueueFeedbackIngestJob({ type: 'enrich-context', rawItemId: inserted.id })

  return { rawItemId: inserted.id, deduplicated: false }
}

/**
 * Enrich context and advance to AI extraction.
 * Called by the {feedback-ingest} queue worker.
 */
export async function enrichAndAdvance(rawItemId: string): Promise<void> {
  const item = await db.query.rawFeedbackItems.findFirst({
    where: eq(rawFeedbackItems.id, rawItemId as any),
    with: { source: true },
  })

  if (!item) {
    console.warn(`[FeedbackIngest] Raw item ${rawItemId} not found, skipping`)
    return
  }

  // Resolve author to a principal
  const author = item.author as {
    email?: string
    externalUserId?: string
    principalId?: string
    name?: string
  }
  const resolvedPrincipalId = await resolveAuthorPrincipal(
    author,
    item.sourceType as FeedbackSourceType
  )

  // Update state: resolve principal, transition to ready_for_extraction
  await db
    .update(rawFeedbackItems)
    .set({
      principalId: resolvedPrincipalId,
      processingState: 'ready_for_extraction',
      stateChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(rawFeedbackItems.id, rawItemId as any))

  // If AI is enabled, enqueue extraction; otherwise mark completed
  if (isAIEnabled()) {
    await enqueueFeedbackAiJob({ type: 'extract-signals', rawItemId })
  } else {
    await db
      .update(rawFeedbackItems)
      .set({
        processingState: 'completed',
        stateChangedAt: new Date(),
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(rawFeedbackItems.id, rawItemId as any))
  }
}
