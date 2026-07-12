/**
 * App subscription backfill (EVENTING-V2 WO-14). Admin-initiated, per-app replay
 * of historical published events into ONE app's webhook — never implicit, never
 * fanned to all sinks. The dry-run path returns a count so an admin sees the
 * blast radius before replaying (replaying 10k historical events into a fresh
 * endpoint is a footgun, so it is always explicit + counted first).
 *
 * Only event types the app is BOTH subscribed to AND scoped for are eligible —
 * the same scope gate the live app-webhook resolver applies.
 */
import { db, apps, events, eq, and, inArray, asc, isNotNull } from '@/lib/server/db'
import { getEventDefinition } from './catalogue'
import { enqueueHookJobsWithIds } from './process'
import type { EventData, EventActor } from './types'

type AppRow = typeof apps.$inferSelect
type EventRow = typeof events.$inferSelect

/** Event types this app may receive: subscribed AND scoped for (WO-13 gate). */
export function deliverableTypes(
  app: Pick<AppRow, 'subscribedEventTypes' | 'grantedScopes'>
): string[] {
  return app.subscribedEventTypes.filter((t) => {
    const scope = getEventDefinition(t)?.requiredScope
    return !!scope && app.grantedScopes.includes(scope)
  })
}

function rowToLegacyEvent(row: EventRow): EventData {
  const actor: EventActor =
    row.actorType === 'user'
      ? { type: 'user', principalId: row.actorId ?? undefined, userId: undefined }
      : { type: 'service', principalId: row.actorId ?? undefined }
  return {
    id: row.eventId,
    type: row.type,
    timestamp: row.occurredAt.toISOString(),
    actor,
    data: row.payload,
  } as unknown as EventData
}

export interface BackfillResult {
  /** Historical published events matching the app's deliverable types. */
  matched: number
  /** Jobs enqueued (0 on dry-run). */
  enqueued: number
}

/**
 * Backfill one app's subscription. `dryRun: true` counts only. The replay
 * enqueues one app_webhook job per matched event with a deterministic id
 * (eventId:app_webhook:appId) so it is idempotent with the live delivery — a
 * historical event already delivered live is deduped, not doubled.
 */
export async function backfillAppSubscription(
  appId: string,
  opts: { dryRun: boolean; enqueue?: typeof enqueueHookJobsWithIds }
): Promise<BackfillResult> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) })
  if (!app || app.status !== 'active' || !app.webhookEndpoint) return { matched: 0, enqueued: 0 }

  const types = deliverableTypes(app)
  if (types.length === 0) return { matched: 0, enqueued: 0 }

  const rows = await db
    .select()
    .from(events)
    .where(and(inArray(events.type, types), isNotNull(events.publishedAt)))
    .orderBy(asc(events.id))

  if (opts.dryRun) return { matched: rows.length, enqueued: 0 }

  const enqueue = opts.enqueue ?? enqueueHookJobsWithIds
  const jobs = rows.map((r) => ({
    name: `${r.type}:app_webhook`,
    data: {
      hookType: 'app_webhook',
      event: rowToLegacyEvent(r),
      target: { url: app.webhookEndpoint! },
      config: { appId: app.id },
    },
    jobId: `${r.eventId}:app_webhook:${app.id}`,
  }))
  await enqueue(jobs)
  return { matched: rows.length, enqueued: jobs.length }
}
