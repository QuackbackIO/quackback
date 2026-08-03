/**
 * Admin-only server function for paginated audit_log reads.
 *
 * Filters (event_type, actor_user_id, time range) compose with AND.
 * Results are ordered by occurred_at DESC and bounded by limit. We
 * request `limit + 1` rows so the caller can advertise hasMore without
 * a second count query (cheap on the (occurred_at DESC) index).
 *
 * CSV export shares the same handler — the UI just stops paginating
 * when hasMore=false and serialises the rows on the client.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { UserId } from '@quackback/ids'
import { and, auditLog, db, desc, eq, gte, ilike, lte, notInArray } from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { AuditEventOutcome, JsonValue } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'
import { toIsoString } from '@/lib/shared/utils'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

const listAuditEventsInput = z.object({
  eventType: z.string().optional(),
  actorUserId: z
    .string()
    .regex(/^user_/)
    .optional(),
  /**
   * Substring match against the denormalised `actor_email` column.
   * Trimmed and lower-cased server-side; uses ILIKE for case-
   * insensitive search against the index-less column (audit_log is
   * small enough that a seq-scan on actor_email is fine for now).
   */
  actorEmail: z.string().min(1).max(254).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().positive().optional(),
  /**
   * Event types to exclude from results. Used by the default view to
   * suppress high-volume events (e.g. portal.widget_handshake.consumed)
   * unless the user explicitly opts in. Ignored when `eventType` is set
   * — a deliberate selection always wins.
   */
  excludeEventTypes: z.array(z.string()).optional(),
})

export type AuditEventRow = {
  id: string
  occurredAt: string
  actorUserId: string | null
  actorEmail: string | null
  actorRole: string | null
  actorIp: string | null
  actorUserAgent: string | null
  eventType: string
  eventOutcome: AuditEventOutcome
  targetType: string | null
  targetId: string | null
  beforeValue: JsonValue | null
  afterValue: JsonValue | null
  metadata: JsonValue | null
  // Observability columns from migration 0070. requestId is indexed —
  // join point for "show me everything that happened during request X"
  // forensics. actorType disambiguates user / service / anonymous in
  // mixed-traffic timelines. authMethod records HOW the actor signed
  // in (session, api-key, sso, magic-link) when known.
  requestId: string | null
  actorType: string | null
  authMethod: string | null
}

export const listAuditEventsFn = createServerFn({ method: 'GET' })
  .validator(listAuditEventsInput)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    const requested = Math.min(data.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const lookahead = requested + 1

    const conditions: SQL[] = []
    if (data.eventType) conditions.push(eq(auditLog.eventType, data.eventType))
    if (data.actorUserId) conditions.push(eq(auditLog.actorUserId, data.actorUserId as UserId))
    if (data.actorEmail) {
      const needle = `%${data.actorEmail.trim().toLowerCase()}%`
      conditions.push(ilike(auditLog.actorEmail, needle))
    }
    if (data.from) conditions.push(gte(auditLog.occurredAt, new Date(data.from)))
    if (data.to) conditions.push(lte(auditLog.occurredAt, new Date(data.to)))
    // Only apply the exclusion list when no specific eventType is selected — a
    // deliberate selection always wins over the default-hide behaviour.
    if (!data.eventType && data.excludeEventTypes && data.excludeEventTypes.length > 0) {
      conditions.push(notInArray(auditLog.eventType, data.excludeEventTypes))
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined

    const rows = await db
      .select()
      .from(auditLog)
      .where(whereClause)
      .orderBy(desc(auditLog.occurredAt))
      .limit(lookahead)

    const hasMore = rows.length > requested
    const visible = hasMore ? rows.slice(0, requested) : rows

    const events: AuditEventRow[] = visible.map((row) => ({
      id: row.id,
      occurredAt: toIsoString(row.occurredAt),
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      actorRole: row.actorRole,
      actorIp: row.actorIp,
      actorUserAgent: row.actorUserAgent,
      eventType: row.eventType,
      eventOutcome: row.eventOutcome as AuditEventOutcome,
      targetType: row.targetType,
      targetId: row.targetId,
      beforeValue: (row.beforeValue as JsonValue | null) ?? null,
      afterValue: (row.afterValue as JsonValue | null) ?? null,
      metadata: (row.metadata as JsonValue | null) ?? null,
      requestId: row.requestId,
      actorType: row.actorType,
      authMethod: row.authMethod,
    }))

    return { events, hasMore }
  })
