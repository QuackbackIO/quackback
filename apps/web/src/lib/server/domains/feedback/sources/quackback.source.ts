/**
 * Quackback feedback source — auto-provisioned passive connector.
 *
 * One quackback source exists per deployment. Created on startup if absent.
 * All new posts (including widget-submitted) are ingested automatically
 * via the feedback_pipeline event hook on post.created.
 */

import { db, eq, feedbackSources } from '@/lib/server/db'
import { sql } from 'drizzle-orm'
import { hashCode } from '@/lib/server/utils'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'quackback-source' })

/**
 * Ensure the quackback feedback source exists.
 * Uses an advisory lock to prevent duplicate sources from concurrent startups.
 */
export async function ensureQuackbackFeedbackSource(): Promise<void> {
  await db.transaction(async (tx) => {
    // Advisory lock scoped to this transaction prevents concurrent creation
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${sql.raw(String(hashCode('quackback_feedback_source')))})`
    )

    const existing = await tx.query.feedbackSources.findFirst({
      where: eq(feedbackSources.sourceType, 'quackback'),
      columns: { id: true },
    })

    if (existing) {
      log.debug({ source_id: existing.id }, 'quackback feedback source already exists')
      return
    }

    const [created] = await tx
      .insert(feedbackSources)
      .values({
        sourceType: 'quackback',
        deliveryMode: 'passive',
        name: 'Quackback',
        enabled: true,
        config: {},
      })
      .returning({ id: feedbackSources.id })

    log.info({ source_id: created.id }, 'created quackback feedback source')
  })
}
