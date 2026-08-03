/**
 * Read-side queries for audit_events. The write path lives in
 * `audit.service.ts` (`recordEvent`); this module provides filtered listing
 * with cursor-based pagination for both server functions and the public
 * REST endpoint.
 */

import { db, auditEvents, and, or, eq, gte, lte, lt, like, desc, sql, asc } from '@/lib/server/db'
import type { PrincipalId } from '@quackback/ids'
import type { AuditSource } from '@/lib/server/db'

export interface ListAuditEventsInput {
  principalId?: PrincipalId
  action?: string
  /** Match all actions starting with this dotted prefix (e.g. "ticket."). */
  actionPrefix?: string
  targetType?: string
  targetId?: string
  source?: AuditSource
  /** Inclusive lower bound on createdAt. */
  from?: Date
  /** Inclusive upper bound on createdAt. */
  to?: Date
  /** Opaque cursor returned by a previous call (`encodeCursor`). */
  cursor?: string
  /** Page size; clamped to [1, 200], default 50. */
  limit?: number
}

export interface ListAuditEventsPage {
  items: Awaited<ReturnType<typeof db.select>> extends never ? never : AuditEventRow[]
  nextCursor: string | null
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export type AuditEventRow = {
  id: string
  createdAt: Date
  principalId: string | null
  action: string
  targetType: string
  targetId: string | null
  diff: JsonValue
  source: AuditSource
  ipAddress: string | null
  userAgent: string | null
}

interface CursorPayload {
  t: number // createdAt epoch ms
  i: string // event id
}

export function encodeCursor(createdAt: Date, id: string): string {
  const payload: CursorPayload = { t: createdAt.getTime(), i: id }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8')
    const obj = JSON.parse(json) as Partial<CursorPayload>
    if (typeof obj.t !== 'number' || typeof obj.i !== 'string') return null
    return { t: obj.t, i: obj.i }
  } catch {
    return null
  }
}

export async function listAuditEvents(
  input: ListAuditEventsInput = {}
): Promise<{ items: AuditEventRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const conds = []
  if (input.principalId) conds.push(eq(auditEvents.principalId, input.principalId))
  if (input.action) conds.push(eq(auditEvents.action, input.action))
  if (input.actionPrefix) conds.push(like(auditEvents.action, `${input.actionPrefix}%`))
  if (input.targetType) conds.push(eq(auditEvents.targetType, input.targetType))
  if (input.targetId) conds.push(eq(auditEvents.targetId, input.targetId))
  if (input.source) conds.push(eq(auditEvents.source, input.source))
  if (input.from) conds.push(gte(auditEvents.createdAt, input.from))
  if (input.to) conds.push(lte(auditEvents.createdAt, input.to))

  if (input.cursor) {
    const c = decodeCursor(input.cursor)
    if (c) {
      const cursorAt = new Date(c.t)
      // Strict (createdAt, id) lexicographic less-than to match
      // ORDER BY created_at DESC, id DESC.
      conds.push(
        or(
          lt(auditEvents.createdAt, cursorAt),
          and(eq(auditEvents.createdAt, cursorAt), lt(auditEvents.id, c.i as never))
        )!
      )
    }
  }

  const where = conds.length > 0 ? and(...conds) : undefined
  const rows = await db
    .select({
      id: auditEvents.id,
      createdAt: auditEvents.createdAt,
      principalId: auditEvents.principalId,
      action: auditEvents.action,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
      diff: auditEvents.diff,
      source: auditEvents.source,
      ipAddress: auditEvents.ipAddress,
      userAgent: auditEvents.userAgent,
    })
    .from(auditEvents)
    .where(where)
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = (hasMore ? rows.slice(0, limit) : rows) as unknown as AuditEventRow[]
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor(items[items.length - 1].createdAt, String(items[items.length - 1].id))
      : null

  // Touch sql to keep the import used by future filters.
  void sql

  return { items, nextCursor }
}

/**
 * Distinct action keys present in the audit log, ascending. Used by the
 * admin audit page to populate the action combobox without needing the
 * caller to know the dotted-key vocabulary up front.
 */
export async function listDistinctActions(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ action: auditEvents.action })
    .from(auditEvents)
    .orderBy(asc(auditEvents.action))
    .limit(200)
  return rows.map((r) => r.action)
}
