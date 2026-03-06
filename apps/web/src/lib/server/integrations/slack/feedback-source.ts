/**
 * Auto-provision a Slack feedback source when the integration is connected.
 * Idempotent: reuses existing source row, updating its integrationId if stale.
 * Uses an advisory lock to prevent duplicate sources from concurrent saves.
 */

import { db, eq, feedbackSources } from '@/lib/server/db'
import { sql } from 'drizzle-orm'
import { hashCode } from '@/lib/server/utils'
import type { IntegrationId } from '@quackback/ids'

export async function ensureSlackFeedbackSource(integrationId: IntegrationId): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${sql.raw(String(hashCode('slack_feedback_source')))})`
    )

    const existing = await tx.query.feedbackSources.findFirst({
      where: eq(feedbackSources.sourceType, 'slack'),
      columns: { id: true, integrationId: true },
    })

    if (existing) {
      // Re-link to the current integration if it was orphaned by a disconnect/reconnect
      if (existing.integrationId !== integrationId) {
        await tx
          .update(feedbackSources)
          .set({ integrationId, updatedAt: new Date() })
          .where(eq(feedbackSources.id, existing.id as any))
      }
      return
    }

    await tx.insert(feedbackSources).values({
      sourceType: 'slack',
      deliveryMode: 'passive',
      name: 'Slack',
      integrationId,
      enabled: true,
      config: {},
    })

    console.log('[Slack] Created feedback source for integration', integrationId)
  })
}
