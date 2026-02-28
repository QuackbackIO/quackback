/**
 * Quackback feedback source — auto-provisioned passive connector.
 *
 * One quackback source exists per deployment. Created on startup if absent.
 * All new posts (including widget-submitted) are ingested automatically
 * via the feedback_pipeline event hook on post.created.
 */

import { db, eq, feedbackSources } from '@/lib/server/db'

/**
 * Ensure the quackback feedback source exists.
 * Creates it if absent. Idempotent — safe to call on every startup.
 */
export async function ensureQuackbackFeedbackSource(): Promise<void> {
  const existing = await db.query.feedbackSources.findFirst({
    where: eq(feedbackSources.sourceType, 'quackback'),
    columns: { id: true },
  })

  if (existing) {
    console.log('[QuackbackSource] Quackback feedback source already exists:', existing.id)
    return
  }

  const [created] = await db
    .insert(feedbackSources)
    .values({
      sourceType: 'quackback',
      deliveryMode: 'passive',
      name: 'Quackback',
      enabled: true,
      config: {},
    })
    .returning({ id: feedbackSources.id })

  console.log('[QuackbackSource] Created quackback feedback source:', created.id)
}
