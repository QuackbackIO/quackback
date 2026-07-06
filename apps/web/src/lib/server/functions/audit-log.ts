/**
 * Admin-only server function for paginated audit_log reads.
 *
 * Filters (event_type, actor_user_id, time range) compose with AND via the
 * shared queryAuditEvents helper (audit/log.ts). Results are ordered by
 * occurred_at DESC and bounded by limit. We request `limit + 1` rows so the
 * caller can advertise hasMore without a second count query (cheap on the
 * (occurred_at DESC) index).
 *
 * CSV export shares the same handler — the UI just stops paginating
 * when hasMore=false and serialises the rows on the client.
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { UserId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { queryAuditEvents, type AuditEventRow } from '@/lib/server/audit/log'
import { requireAuth } from './auth-helpers'

export type { AuditEventRow }

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

export const listAuditEventsFn = createServerFn({ method: 'GET' })
  .validator(listAuditEventsInput)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.AUDIT_VIEW })

    const requested = Math.min(data.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const lookahead = requested + 1

    const rows = await queryAuditEvents({
      eventType: data.eventType,
      actorUserId: data.actorUserId as UserId | undefined,
      actorEmail: data.actorEmail,
      from: data.from ? new Date(data.from) : undefined,
      to: data.to ? new Date(data.to) : undefined,
      excludeEventTypes: data.excludeEventTypes,
      limit: lookahead,
    })

    const hasMore = rows.length > requested
    const events = hasMore ? rows.slice(0, requested) : rows

    return { events, hasMore }
  })
