/**
 * Quackback feedback source — auto-provisioned passive connector.
 *
 * One quackback source exists per deployment. Created on startup if absent.
 * All new posts (including widget-submitted) are ingested automatically
 * via the feedback_pipeline event hook on post.created.
 */

import { db } from '@/lib/server/db'
import { generateId } from '@quackback/ids'
import { sql } from 'drizzle-orm'

/**
 * Ensure the quackback feedback source exists.
 * Uses atomic INSERT ... WHERE NOT EXISTS to prevent duplicates
 * from concurrent startups.
 */
export async function ensureQuackbackFeedbackSource(): Promise<void> {
  const newId = generateId('feedback_source')

  const [row] = await db.execute<{ id: string; created: boolean }>(sql`
    WITH inserted AS (
      INSERT INTO feedback_sources (id, source_type, delivery_mode, name, enabled, config, created_at, updated_at)
      SELECT ${newId}, 'quackback', 'passive', 'Quackback', true, '{}'::jsonb, now(), now()
      WHERE NOT EXISTS (
        SELECT 1 FROM feedback_sources WHERE source_type = 'quackback'
      )
      RETURNING id, true AS created
    )
    SELECT id, created FROM inserted
    UNION ALL
    SELECT id::text, false AS created FROM feedback_sources WHERE source_type = 'quackback'
    LIMIT 1
  `)

  if (row?.created) {
    console.log('[QuackbackSource] Created quackback feedback source:', row.id)
  } else {
    console.log('[QuackbackSource] Quackback feedback source already exists:', row?.id)
  }
}
