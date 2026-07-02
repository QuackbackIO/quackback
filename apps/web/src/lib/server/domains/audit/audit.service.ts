/**
 * Audit domain — append-only workspace audit log.
 *
 * `recordEvent` is the single write entry-point and is intentionally
 * fire-and-forget-friendly: the caller's transaction does NOT need to wait
 * for the insert. We log errors instead of propagating them, because losing
 * an audit row should never crash a write path.
 *
 * For test/debug determinism, callers that need synchronous behaviour can
 * `await recordEvent(...)`.
 */

import { db, auditEvents, desc, eq, and, gte, lte } from '@/lib/server/db'
import type { PrincipalId, AuditEventId } from '@quackback/ids'
import type { AuditDiff, AuditSource } from '@/lib/server/db'

export interface RecordEventInput {
  /** Actor performing the action; null for system-initiated. */
  principalId?: PrincipalId | null
  /** Dotted action name (e.g. "role.granted", "ticket.shared"). */
  action: string
  /** Type of the resource the action targets. */
  targetType: string
  /** TypeID of the resource (stored as text). */
  targetId?: string | null
  diff?: AuditDiff
  source?: AuditSource
  ipAddress?: string | null
  userAgent?: string | null
}

export async function recordEvent(input: RecordEventInput): Promise<AuditEventId | null> {
  try {
    const [row] = await db
      .insert(auditEvents)
      .values({
        principalId: input.principalId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        diff: input.diff ?? {},
        source: input.source ?? 'web',
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      })
      .returning({ id: auditEvents.id })
    return (row?.id as AuditEventId | undefined) ?? null
  } catch (error) {
    console.error('[domain:audit] failed to record event', { action: input.action, error })
    return null
  }
}

export interface ListEventsFilter {
  principalId?: PrincipalId
  action?: string
  targetType?: string
  targetId?: string
  /** Inclusive lower bound. */
  since?: Date
  /** Inclusive upper bound. */
  until?: Date
  limit?: number
}

export async function listEvents(filter: ListEventsFilter = {}) {
  const conditions = []
  if (filter.principalId) conditions.push(eq(auditEvents.principalId, filter.principalId))
  if (filter.action) conditions.push(eq(auditEvents.action, filter.action))
  if (filter.targetType) conditions.push(eq(auditEvents.targetType, filter.targetType))
  if (filter.targetId) conditions.push(eq(auditEvents.targetId, filter.targetId))
  if (filter.since) conditions.push(gte(auditEvents.createdAt, filter.since))
  if (filter.until) conditions.push(lte(auditEvents.createdAt, filter.until))

  const where = conditions.length > 0 ? and(...conditions) : undefined
  return db
    .select()
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt))
    .limit(Math.min(filter.limit ?? 100, 500))
}
