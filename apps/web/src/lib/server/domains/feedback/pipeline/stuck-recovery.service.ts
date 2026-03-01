/**
 * Stuck-item recovery service.
 *
 * Detects items stuck in intermediate states (extracting/interpreting)
 * for more than 30 minutes and resets them for retry.
 */

import { db, eq, rawFeedbackItems, feedbackSignals } from '@/lib/server/db'
import { enqueueFeedbackAiJob } from '../queues/feedback-ai-queue'

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
      // Mark permanently failed
      await db
        .update(rawFeedbackItems)
        .set({
          processingState: 'failed',
          stateChangedAt: new Date(),
          lastError: `Stuck in ${item.processingState} state after ${item.attemptCount} attempts`,
          updatedAt: new Date(),
        })
        .where(eq(rawFeedbackItems.id, item.id))
      continue
    }

    // Reset to ready_for_extraction and re-enqueue
    await db
      .update(rawFeedbackItems)
      .set({
        processingState: 'ready_for_extraction',
        stateChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(rawFeedbackItems.id, item.id))

    await enqueueFeedbackAiJob({ type: 'extract-signals', rawItemId: item.id })
  }

  // Recover stuck signals
  const stuckSignals = await db.query.feedbackSignals.findMany({
    where: (t, { and, eq, lt }) =>
      and(eq(t.processingState, 'interpreting'), lt(t.updatedAt, threshold)),
    columns: { id: true },
  })

  for (const signal of stuckSignals) {
    await db
      .update(feedbackSignals)
      .set({ processingState: 'pending_interpretation', updatedAt: new Date() })
      .where(eq(feedbackSignals.id, signal.id))

    await enqueueFeedbackAiJob({ type: 'interpret-signal', signalId: signal.id })
  }

  if (stuckRawItems.length > 0 || stuckSignals.length > 0) {
    console.log(
      `[StuckRecovery] Recovered ${stuckRawItems.length} raw items, ${stuckSignals.length} signals`
    )
  }
}
