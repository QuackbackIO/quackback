/**
 * Feedback ingestion service.
 *
 * Receives raw feedback seeds, deduplicates, inserts raw items,
 * resolves authors, and enqueues for AI processing.
 */

import { db, eq, and, rawFeedbackItems } from '@/lib/server/db'
import type { FeedbackSourceId, RawFeedbackItemId } from '@quackback/ids'
import { getOpenAI } from '@/lib/server/domains/ai/config'
import { enqueueFeedbackIngestJob } from '../queues/feedback-ingest-queue'
import { enqueueFeedbackAiJob } from '../queues/feedback-ai-queue'
import { resolveAuthorPrincipal } from './author-resolver'
import { logPipelineEvent } from '../pipeline/pipeline-log'
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
    await logPipelineEvent({
      eventType: 'ingestion.deduplicated',
      rawFeedbackItemId: existing.id,
      detail: { dedupeKey, existingItemId: existing.id },
    })
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

  await logPipelineEvent({
    eventType: 'ingestion.received',
    rawFeedbackItemId: inserted.id,
    detail: {
      sourceType: context.sourceType,
      sourceId: context.sourceId,
      dedupeKey,
      externalId: seed.externalId,
      hasAuthorEmail: !!seed.author.email,
      hasExternalUserId: !!seed.author.externalUserId,
    },
  })

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
    where: eq(rawFeedbackItems.id, rawItemId as RawFeedbackItemId),
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
  const authorResolution = await resolveAuthorPrincipal(
    author,
    item.sourceType as FeedbackSourceType
  )

  await logPipelineEvent({
    eventType: 'enrichment.author_resolved',
    rawFeedbackItemId: rawItemId,
    detail: {
      method: authorResolution.method,
      principalId: authorResolution.principalId,
    },
  })

  // Update state: resolve principal, transition to ready_for_extraction
  await db
    .update(rawFeedbackItems)
    .set({
      principalId: authorResolution.principalId,
      processingState: 'ready_for_extraction',
      stateChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(rawFeedbackItems.id, rawItemId as RawFeedbackItemId))

  // If AI is enabled, enqueue extraction; otherwise mark completed
  if (getOpenAI()) {
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
      .where(eq(rawFeedbackItems.id, rawItemId as RawFeedbackItemId))
  }
}
