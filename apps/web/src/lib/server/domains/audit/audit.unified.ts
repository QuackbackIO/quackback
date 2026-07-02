/**
 * Read-side union of the two append-only audit stores:
 * - audit_events: workspace operational audit rows
 * - audit_log: security/auth/admin audit rows
 *
 * Writers stay separate. This module only normalizes both shapes for the
 * canonical admin audit page.
 */
import type { AnyColumn, SQL } from 'drizzle-orm'
import type { PrincipalId } from '@quackback/ids'
import type { AuditSource } from '@/lib/server/db'
import {
  and,
  auditEvents,
  auditLog,
  db,
  desc,
  eq,
  gte,
  ilike,
  like,
  lt,
  lte,
  notInArray,
  or,
  principal,
  user,
} from '@/lib/server/db'

export type UnifiedAuditOrigin = 'workspace' | 'security'

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }
export type UnifiedAuditDiff = { [k: string]: JsonValue }

export interface UnifiedAuditEventRow {
  id: string
  origin: UnifiedAuditOrigin
  occurredAt: Date
  principalId: string | null
  actorUserId: string | null
  actorEmail: string | null
  actorDisplayName: string | null
  actorRole: string | null
  actorType: string | null
  authMethod: string | null
  action: string
  outcome: 'success' | 'failure' | null
  source: AuditSource | null
  targetType: string | null
  targetId: string | null
  requestId: string | null
  ipAddress: string | null
  userAgent: string | null
  diff: JsonValue
  metadata: JsonValue
}

export interface ListUnifiedAuditEventsInput {
  origin?: UnifiedAuditOrigin
  principalId?: PrincipalId
  actorEmail?: string
  action?: string
  actionPrefix?: string
  targetType?: string
  targetId?: string
  source?: AuditSource
  from?: Date
  to?: Date
  cursor?: string
  limit?: number
  excludeSecurityActions?: string[]
}

export interface ListUnifiedAuditEventsPage {
  items: UnifiedAuditEventRow[]
  nextCursor: string | null
}

interface UnifiedCursorPayload {
  t: number
  o: UnifiedAuditOrigin
  i: string
}

const ORIGIN_ORDER: Record<UnifiedAuditOrigin, number> = {
  workspace: 0,
  security: 1,
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function encodeUnifiedAuditCursor(
  row: Pick<UnifiedAuditEventRow, 'occurredAt' | 'origin' | 'id'>
): string {
  const payload: UnifiedCursorPayload = {
    t: row.occurredAt.getTime(),
    o: row.origin,
    i: row.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

export function decodeUnifiedAuditCursor(cursor: string | undefined): UnifiedCursorPayload | null {
  if (!cursor) return null
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8')
    const obj = JSON.parse(json) as Partial<UnifiedCursorPayload>
    if (
      typeof obj.t !== 'number' ||
      typeof obj.i !== 'string' ||
      (obj.o !== 'workspace' && obj.o !== 'security')
    ) {
      return null
    }
    return { t: obj.t, o: obj.o, i: obj.i }
  } catch {
    return null
  }
}

export function compareUnifiedAuditRows(
  a: Pick<UnifiedAuditEventRow, 'occurredAt' | 'origin' | 'id'>,
  b: Pick<UnifiedAuditEventRow, 'occurredAt' | 'origin' | 'id'>
): number {
  const timeDiff = b.occurredAt.getTime() - a.occurredAt.getTime()
  if (timeDiff !== 0) return timeDiff

  const originDiff = ORIGIN_ORDER[a.origin] - ORIGIN_ORDER[b.origin]
  if (originDiff !== 0) return originDiff

  return b.id.localeCompare(a.id)
}

function cursorRow(
  cursor: UnifiedCursorPayload
): Pick<UnifiedAuditEventRow, 'occurredAt' | 'origin' | 'id'> {
  return {
    occurredAt: new Date(cursor.t),
    origin: cursor.o,
    id: cursor.i,
  }
}

function isAfterCursor(row: UnifiedAuditEventRow, cursor: UnifiedCursorPayload | null): boolean {
  return !cursor || compareUnifiedAuditRows(row, cursorRow(cursor)) > 0
}

export function pageUnifiedAuditRows(
  rows: UnifiedAuditEventRow[],
  opts: { limit?: number; cursor?: string } = {}
): ListUnifiedAuditEventsPage {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const cursor = decodeUnifiedAuditCursor(opts.cursor)
  const sorted = rows.filter((row) => isAfterCursor(row, cursor)).sort(compareUnifiedAuditRows)
  const items = sorted.slice(0, limit)
  const hasMore = sorted.length > limit
  const nextCursor =
    hasMore && items.length > 0 ? encodeUnifiedAuditCursor(items[items.length - 1]) : null

  return { items, nextCursor }
}

function buildCursorCondition(
  origin: UnifiedAuditOrigin,
  occurredAtColumn: AnyColumn,
  idColumn: AnyColumn,
  cursor: UnifiedCursorPayload | null
): SQL | undefined {
  if (!cursor) return undefined

  const at = new Date(cursor.t)
  const orderDiff = ORIGIN_ORDER[origin] - ORIGIN_ORDER[cursor.o]

  if (orderDiff > 0) {
    return lte(occurredAtColumn, at)
  }
  if (orderDiff < 0) {
    return lt(occurredAtColumn, at)
  }

  return or(lt(occurredAtColumn, at), and(eq(occurredAtColumn, at), lt(idColumn, cursor.i)))!
}

function cleanNeedle(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? `%${trimmed}%` : undefined
}

function shouldQueryWorkspace(input: ListUnifiedAuditEventsInput): boolean {
  return input.origin !== 'security'
}

function shouldQuerySecurity(input: ListUnifiedAuditEventsInput): boolean {
  if (input.origin === 'workspace') return false
  if (input.principalId) return false
  if (input.source) return false
  return true
}

function compactContext(
  entries: Record<string, JsonValue | undefined>
): Record<string, JsonValue> | undefined {
  const context = Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== null && value !== undefined)
  ) as Record<string, JsonValue>
  return Object.keys(context).length > 0 ? context : undefined
}

function securityDiff(row: {
  beforeValue: unknown
  afterValue: unknown
  metadata: unknown
  requestId: string | null
  actorType: string | null
  authMethod: string | null
}): JsonValue {
  const diff: UnifiedAuditDiff = {}
  if (row.beforeValue !== null && row.beforeValue !== undefined) {
    diff.before = row.beforeValue as JsonValue
  }
  if (row.afterValue !== null && row.afterValue !== undefined) {
    diff.after = row.afterValue as JsonValue
  }
  const context = compactContext({
    metadata: row.metadata as JsonValue,
    requestId: row.requestId,
    actorType: row.actorType,
    authMethod: row.authMethod,
  })
  if (context) diff.context = context
  return diff
}

export async function listUnifiedAuditEvents(
  input: ListUnifiedAuditEventsInput = {}
): Promise<ListUnifiedAuditEventsPage> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const cursor = decodeUnifiedAuditCursor(input.cursor)
  const actorEmailNeedle = cleanNeedle(input.actorEmail)
  const pageSize = limit + 1

  const queries: Array<Promise<UnifiedAuditEventRow[]>> = []

  if (shouldQueryWorkspace(input)) {
    const conds: SQL[] = []
    if (input.principalId) conds.push(eq(auditEvents.principalId, input.principalId))
    if (input.action) conds.push(eq(auditEvents.action, input.action))
    if (input.actionPrefix) conds.push(like(auditEvents.action, `${input.actionPrefix}%`))
    if (input.targetType) conds.push(eq(auditEvents.targetType, input.targetType))
    if (input.targetId) conds.push(eq(auditEvents.targetId, input.targetId))
    if (input.source) conds.push(eq(auditEvents.source, input.source))
    if (input.from) conds.push(gte(auditEvents.createdAt, input.from))
    if (input.to) conds.push(lte(auditEvents.createdAt, input.to))
    if (actorEmailNeedle) conds.push(ilike(user.email, actorEmailNeedle))
    const cursorCond = buildCursorCondition(
      'workspace',
      auditEvents.createdAt,
      auditEvents.id,
      cursor
    )
    if (cursorCond) conds.push(cursorCond)

    const where = conds.length > 0 ? and(...conds) : undefined

    queries.push(
      db
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
          actorUserId: principal.userId,
          actorEmail: user.email,
          actorDisplayName: principal.displayName,
          actorRole: principal.role,
          actorType: principal.type,
          userName: user.name,
        })
        .from(auditEvents)
        .leftJoin(principal, eq(auditEvents.principalId, principal.id))
        .leftJoin(user, eq(principal.userId, user.id))
        .where(where)
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(pageSize)
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            origin: 'workspace' as const,
            occurredAt: row.createdAt,
            principalId: row.principalId,
            actorUserId: row.actorUserId,
            actorEmail: row.actorEmail,
            actorDisplayName: row.actorDisplayName ?? row.userName ?? null,
            actorRole: row.actorRole,
            actorType: row.actorType,
            authMethod: null,
            action: row.action,
            outcome: null,
            source: row.source,
            targetType: row.targetType,
            targetId: row.targetId,
            requestId: null,
            ipAddress: row.ipAddress,
            userAgent: row.userAgent,
            diff: row.diff as JsonValue,
            metadata: null,
          }))
        )
    )
  }

  if (shouldQuerySecurity(input)) {
    const conds: SQL[] = []
    if (input.action) conds.push(eq(auditLog.eventType, input.action))
    if (input.actionPrefix) conds.push(like(auditLog.eventType, `${input.actionPrefix}%`))
    if (input.targetType) conds.push(eq(auditLog.targetType, input.targetType))
    if (input.targetId) conds.push(eq(auditLog.targetId, input.targetId))
    if (input.from) conds.push(gte(auditLog.occurredAt, input.from))
    if (input.to) conds.push(lte(auditLog.occurredAt, input.to))
    if (actorEmailNeedle) conds.push(ilike(auditLog.actorEmail, actorEmailNeedle))
    if (
      !input.action &&
      !input.actionPrefix &&
      input.excludeSecurityActions &&
      input.excludeSecurityActions.length > 0
    ) {
      conds.push(notInArray(auditLog.eventType, input.excludeSecurityActions))
    }
    const cursorCond = buildCursorCondition('security', auditLog.occurredAt, auditLog.id, cursor)
    if (cursorCond) conds.push(cursorCond)

    const where = conds.length > 0 ? and(...conds) : undefined

    queries.push(
      db
        .select({
          id: auditLog.id,
          occurredAt: auditLog.occurredAt,
          actorUserId: auditLog.actorUserId,
          actorEmail: auditLog.actorEmail,
          actorRole: auditLog.actorRole,
          actorIp: auditLog.actorIp,
          actorUserAgent: auditLog.actorUserAgent,
          eventType: auditLog.eventType,
          eventOutcome: auditLog.eventOutcome,
          targetType: auditLog.targetType,
          targetId: auditLog.targetId,
          beforeValue: auditLog.beforeValue,
          afterValue: auditLog.afterValue,
          metadata: auditLog.metadata,
          requestId: auditLog.requestId,
          actorType: auditLog.actorType,
          authMethod: auditLog.authMethod,
        })
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
        .limit(pageSize)
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            origin: 'security' as const,
            occurredAt: row.occurredAt,
            principalId: null,
            actorUserId: row.actorUserId,
            actorEmail: row.actorEmail,
            actorDisplayName: null,
            actorRole: row.actorRole,
            actorType: row.actorType,
            authMethod: row.authMethod,
            action: row.eventType,
            outcome: row.eventOutcome as 'success' | 'failure',
            source: null,
            targetType: row.targetType,
            targetId: row.targetId,
            requestId: row.requestId,
            ipAddress: row.actorIp,
            userAgent: row.actorUserAgent,
            diff: securityDiff(row),
            metadata: (row.metadata as JsonValue) ?? null,
          }))
        )
    )
  }

  return pageUnifiedAuditRows((await Promise.all(queries)).flat(), {
    limit,
    cursor: input.cursor,
  })
}

export async function listUnifiedAuditActions(): Promise<string[]> {
  const [workspaceRows, securityRows] = await Promise.all([
    db
      .selectDistinct({ action: auditEvents.action })
      .from(auditEvents)
      .orderBy(auditEvents.action)
      .limit(200),
    db
      .selectDistinct({ action: auditLog.eventType })
      .from(auditLog)
      .orderBy(auditLog.eventType)
      .limit(200),
  ])

  return Array.from(new Set([...workspaceRows, ...securityRows].map((row) => row.action))).sort()
}
