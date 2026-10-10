/**
 * Test helper: write the events-log row a status change produces, as the
 * event dispatch does in production. The SLA pause reconcile rebuilds paused
 * spans from these rows (sla.pause-history.ts), so a test that sends a status
 * event to the SLA reaction writes its row too. Uses the rolled-back fixture
 * transaction.
 */
import { createId } from '@quackback/ids'
import { testDb } from '@/lib/server/__tests__/db-test-fixture'
import { events } from '@/lib/server/db'

export async function recordStatusChange(
  entityType: 'conversation' | 'ticket',
  entityId: string,
  previousStatus: string,
  newStatus: string,
  at: Date
): Promise<void> {
  await testDb.insert(events).values({
    eventId: createId('event'),
    type: `${entityType}.status_changed`,
    entityType,
    entityId,
    actorType: 'user',
    payload: { previousStatus, newStatus },
    occurredAt: at,
  })
}
