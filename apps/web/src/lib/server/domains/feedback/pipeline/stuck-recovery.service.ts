/**
 * Stuck-item recovery service.
 *
 * Detects items stuck in intermediate states (extracting/interpreting)
 * for more than 30 minutes and resets them for retry.
 */

import { db, and, eq, rawFeedbackItems, feedbackSignals } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { logPipelineEvent } from './pipeline-log'
import { enqueueFeedbackAiJob } from '../queues/feedback-ai-queue'

const log = logger.child({ component: 'feedback-stuck-recovery' })

const STUCK_THRESHOLD_MINUTES = 30
const MAX_ATTEMPTS = 3

/**
 * Find and recover items stuck in intermediate processing states.
 */
export async function recoverStuckItems(): Promise<void> {
  const threshold = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000)

  // Recover stuck raw items
  const stuckRawItems = await db.query.rawFeedbackItems.findMany({
    where: (t, { and, inArray, lt }) =>
      and(
        inArray(t.processingState, ['extracting', 'interpreting']),
        lt(t.stateChangedAt, threshold)
      ),
    columns: { id: true, processingState: true, attemptCount: true },
  })

  for (const item of stuckRawItems) {
    if (item.attemptCount >= MAX_ATTEMPTS) {
      // Mark permanently failed. WHERE pins processingState to the
      // value we read so a concurrent legitimate transition (worker
      // finished extraction between our SELECT and UPDATE) isn't
      // silently overwritten back to 'failed'. `.returning()` lets us
      // tell a real recovery from a no-op so we don't write a
      // misleading audit row or enqueue a stale job.
      const flipped = await db
        .update(rawFeedbackItems)
        .set({
          processingState: 'failed',
          stateChangedAt: new Date(),
          lastError: `Stuck in ${item.processingState} state after ${item.attemptCount} attempts`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(rawFeedbackItems.id, item.id),
            eq(rawFeedbackItems.processingState, item.processingState)
          )
        )
        .returning({ id: rawFeedbackItems.id })
      if (flipped.length === 0) continue

      await logPipelineEvent({
        eventType: 'recovery.max_attempts_exceeded',
        rawFeedbackItemId: item.id,
        detail: {
          previousState: item.processingState,
          attemptCount: item.attemptCount,
          maxAttempts: MAX_ATTEMPTS,
          error: `Stuck in ${item.processingState} state after ${item.attemptCount} attempts`,
        },
      })
      continue
    }

    // Reset to ready_for_extraction and re-enqueue. Same source-state
    // pin + returning() guard so we only log + enqueue when the UPDATE
    // actually rewound the row.
    const flipped = await db
      .update(rawFeedbackItems)
      .set({
        processingState: 'ready_for_extraction',
        stateChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(rawFeedbackItems.id, item.id),
          eq(rawFeedbackItems.processingState, item.processingState)
        )
      )
      .returning({ id: rawFeedbackItems.id })
    if (flipped.length === 0) continue

    await logPipelineEvent({
      eventType: 'recovery.raw_item_reset',
      rawFeedbackItemId: item.id,
      detail: {
        previousState: item.processingState,
        attemptCount: item.attemptCount,
        maxAttempts: MAX_ATTEMPTS,
        nextState: 'ready_for_extraction',
      },
    })

    await enqueueFeedbackAiJob({ type: 'extract-signals', rawItemId: item.id })
  }

  // Recover stuck signals
  const stuckSignals = await db.query.feedbackSignals.findMany({
    where: (t, { and, eq, lt }) =>
      and(eq(t.processingState, 'interpreting'), lt(t.updatedAt, threshold)),
    columns: { id: true, rawFeedbackItemId: true },
  })

  for (const signal of stuckSignals) {
    // Same pin + returning() guard as the raw-items loop above. We
    // selected with processingState='interpreting'; if a concurrent
    // worker has already flipped it to 'completed', the UPDATE is a
    // no-op and we skip the log + enqueue.
    const flipped = await db
      .update(feedbackSignals)
      .set({ processingState: 'pending_interpretation', updatedAt: new Date() })
      .where(
        and(eq(feedbackSignals.id, signal.id), eq(feedbackSignals.processingState, 'interpreting'))
      )
      .returning({ id: feedbackSignals.id })
    if (flipped.length === 0) continue

    await logPipelineEvent({
      eventType: 'recovery.signal_reset',
      rawFeedbackItemId: signal.rawFeedbackItemId,
      signalId: signal.id,
      detail: {
        previousState: 'interpreting',
        nextState: 'pending_interpretation',
      },
    })

    await enqueueFeedbackAiJob({ type: 'interpret-signal', signalId: signal.id })
  }

  if (stuckRawItems.length > 0 || stuckSignals.length > 0) {
    log.info(
      { raw_item_count: stuckRawItems.length, signal_count: stuckSignals.length },
      'recovered stuck items'
    )
  }
}
