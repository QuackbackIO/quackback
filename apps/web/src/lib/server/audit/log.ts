/**
 * Append-only audit log helper.
 *
 * One call per security-sensitive admin action. Best-effort: insert
 * failures are logged and swallowed so the primary mutation isn't
 * blocked by audit-log downtime. Callers must not rely on the row
 * being visible to a subsequent SELECT in the same transaction —
 * inserts are made on the global connection, not the caller's tx.
 */
import {
  db,
  auditLog,
  and,
  desc,
  eq,
  gte,
  lte,
  ilike,
  inArray,
  notInArray,
  type Transaction,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { UserId } from '@quackback/ids'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'
import { logger } from '@/lib/server/logger'
import { ASSISTANT_CONFIG_EVENT_LABELS } from '@/lib/shared/assistant/config-audit-events'
import type { JsonValue } from '@/lib/shared/json'

const log = logger.child({ component: 'audit' })

/** A JSON-shaped value — fits into a Postgres jsonb column. Re-exported from the
 *  shared module so client/shared code can reference it without importing from
 *  `@/lib/server`. */
export type { JsonValue }

/**
 * Closed taxonomy of audit event types.
 *
 * Add new entries as features land. Existing rows reference the
 * string literal directly so reordering / renaming is a schema-level
 * change — never reuse a retired identifier.
 */
export type AuditEventType =
  | 'sso.enforcement.domain.enabled'
  | 'sso.enforcement.domain.disabled'
  | 'sso.config.changed'
  // Multi-provider identity-provider CRUD (Task 15)
  | 'idp.created'
  | 'idp.updated'
  | 'idp.deleted'
  | 'idp.credentials.changed'
  | 'idp.domain.enforced'
  | 'idp.domain.unenforced'
  | 'sso.recovery_codes.generated'
  | 'sso.recovery_codes.used'
  | 'sso.recovery_codes.invalidated'
  | 'auth.password.enabled'
  | 'auth.password.disabled'
  | 'auth.magic_link.enabled'
  | 'auth.magic_link.disabled'
  | 'auth.method.blocked'
  | 'auth.signin.success'
  | 'auth.signin.new_device'
  | 'auth.signin.rate_limited'
  | 'session.revoked.bulk'
  | 'session.revoked.individual'
  | 'user.role.changed'
  | 'user.invited'
  | 'user.removed'
  // Custom-role CRUD (role.manage)
  | 'role.created'
  | 'role.updated'
  | 'role.deleted'
  | 'two_factor.reset_by_admin'
  | 'two_factor.enabled'
  | 'two_factor.disabled'
  // OAuth provider — see auth/refresh-grace.ts (temporary, better-auth#8512)
  | 'oauth.refresh_token.grace_heal'
  // v1 access controls
  | 'board.access.changed'
  | 'moderation.default.changed'
  | 'portal.visibility.changed'
  | 'portal.allowed_domains.changed'
  | 'post.moderation.approved'
  | 'post.moderation.rejected'
  | 'post.moderation.held'
  | 'comment.moderation.approved'
  | 'comment.moderation.rejected'
  | 'comment.moderation.held'
  | 'segment.member.added'
  | 'segment.member.removed'
  | 'segment.sso_mapping.changed'
  // v1 portal invites
  | 'portal.invite.sent'
  | 'portal.invite.resent'
  | 'portal.invite.accepted'
  | 'portal.invite.revoked'
  | 'portal.invite.link_minted'
  // Team-kind invitations live in the same `invitation` table as portal
  // ones but route to admin/member onboarding (not portal access). The
  // sweep emits a distinct event per kind so audit reviewers and
  // compliance dashboards don't conflate the two.
  | 'team.invite.expired'
  // v1 portal segment allowlist
  | 'portal.allowed_segments.changed'
  // v1 portal widget sign-in toggle
  | 'portal.widget_signin.changed'
  // v1 widget OTT handoff
  | 'portal.widget_handshake.consumed'
  | 'portal.widget_handshake.invalid'
  // v1 audit-log observability
  | 'portal.access.denied' // OWASP authz_fail — gate denied an authenticated visitor
  | 'auth.signin.failed' // OWASP authn_login_fail — twin of auth.signin.success
  | 'portal.invite.expired' // emitted by the daily sweep for pending invites past their expiry
  // Imports & exports hub (§I3): full-content conversation/ticket export
  | 'export.conversations.downloaded'
  // Workspace data export (async ZIP): requested from the hub, artifact downloaded
  | 'export.workspace.requested'
  | 'export.workspace.downloaded'
  // AI config changelog: assistant customization mutations surfaced together
  // on the assistant admin page.
  | 'assistant.guidance.created'
  | 'assistant.guidance.updated'
  | 'assistant.guidance.reordered'
  | 'assistant.guidance.deleted'
  | 'assistant.tool_controls.changed'
  | 'assistant.surfaces.changed'
  | 'assistant.basics.changed'
  | 'assistant.identity.changed'
  | 'assistant.voice.changed'
  | 'assistant.instructions.changed'
  | 'assistant.knowledge.changed'
  | 'assistant.capabilities.changed'
  | 'assistant.channels.changed'
  | 'assistant.deployment.changed'
  // Verified-email assertion. `emailVerified: true` is a trust decision, not a
  // data field — it grants the same portal access as a confirmed email
  // (domain-match, invite claim, segment portal-access grants). Every path
  // that lets an operator assert it without the user proving ownership emits
  // one of these.
  | 'user.email_verified.asserted' // per-user: admin contact creation, REST identify

/**
 * The subset of {@link AuditEventType} the AI config changelog reads back
 * (assistant-config-changelog.ts). Derived from the shared label map's keys
 * rather than hand-listed, so the two can never diverge — a prefix/LIKE
 * match would work too, but this keeps the reader query on
 * `inArray(eventType, ...)`, which stays on the existing
 * (event_type, occurred_at) index.
 */
export const ASSISTANT_CONFIG_AUDIT_EVENTS = Object.keys(
  ASSISTANT_CONFIG_EVENT_LABELS
) as AuditEventType[]

export type AuditEventOutcome = 'success' | 'failure'

export type AuditActorType = 'user' | 'service' | 'anonymous' | 'system' | 'api_key'
export type AuditAuthMethod = 'password' | 'sso' | 'magic_link' | 'ott' | 'api_key' | 'session'

export interface AuditActor {
  userId?: UserId | null
  email?: string | null
  role?: string | null
  /** Denormalised from principal.type at write time. */
  type?: AuditActorType | null
  /** Auth method for sign-in events; null for all others. */
  authMethod?: AuditAuthMethod | null
}

export interface AuditTarget {
  type: string
  id?: string | null
}

export interface RecordAuditEventInput {
  event: AuditEventType
  outcome?: AuditEventOutcome
  actor: AuditActor
  /** Request headers — IP comes from `getClientIp`, UA from `user-agent`. */
  headers?: Headers
  target?: AuditTarget
  before?: unknown
  after?: unknown
  metadata?: Record<string, unknown>
}

/** Map a requireAuth() result onto the audit row's denormalised actor fields. */
export function actorFromAuth(auth: AuthContext): AuditActor {
  return {
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.principal.role,
    type: auth.principal.type as AuditActorType,
    // authMethod is generally unknowable from a session-cookie context;
    // sign-in events that DO know the method should set it explicitly.
  }
}

/**
 * Upper bound on the stored request_id. PostgreSQL's btree refuses
 * index entries above ~2700 bytes; recordAuditEvent's catch swallows
 * insert failures, so an attacker who can set the x-request-id header
 * could otherwise silently suppress security events by sending a
 * multi-KB value. 256 chars is comfortably above every legitimate
 * correlation-id format (UUIDs, ULIDs, hex hashes, TypeIDs, OpenTelemetry
 * traceparent payloads) while well below the btree limit.
 */
const REQUEST_ID_MAX_LEN = 256

function capRequestId(value: string | null): string | null {
  if (value === null) return null
  return value.length > REQUEST_ID_MAX_LEN ? value.slice(0, REQUEST_ID_MAX_LEN) : value
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  const values = auditInsertValues(input)

  try {
    await db.insert(auditLog).values(values)
  } catch (error) {
    log.error({ err: error, event: input.event }, 'recordAuditEvent failed')
  }
}

function auditInsertValues(input: RecordAuditEventInput): typeof auditLog.$inferInsert {
  const ip = input.headers ? getClientIp(input.headers) : null
  const userAgent = input.headers?.get('user-agent') ?? null
  const requestId = capRequestId(
    input.headers?.get('x-request-id') ?? input.headers?.get('x-correlation-id') ?? null
  )

  return {
    eventType: input.event,
    eventOutcome: input.outcome ?? 'success',
    actorUserId: input.actor.userId ?? null,
    actorEmail: input.actor.email ?? null,
    actorRole: input.actor.role ?? null,
    actorIp: ip === 'unknown' ? null : ip,
    actorUserAgent: userAgent,
    requestId,
    actorType: input.actor.type ?? null,
    authMethod: input.actor.authMethod ?? null,
    targetType: input.target?.type ?? null,
    targetId: input.target?.id ?? null,
    beforeValue: input.before ?? null,
    afterValue: input.after ?? null,
    metadata: input.metadata ?? null,
  }
}

/** Strict audit insert for mutations whose data write and audit row must commit together. */
export async function recordAuditEventInTransaction(
  tx: Transaction,
  input: RecordAuditEventInput
): Promise<void> {
  await tx.insert(auditLog).values(auditInsertValues(input))
}

/**
 * A single audit_log row, projected for readers. The one DTO shape for every
 * audit-log reader — both the paginated admin feed (listAuditEventsFn) and
 * the AI config changelog (getAssistantConfigChangelogFn) return this.
 */
export interface AuditEventRow {
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

export interface QueryAuditEventsFilters {
  /** Exact match against a single event type. */
  eventType?: string
  /** Inclusion filter against a set of event types (`inArray`) — the
   *  companion to `excludeEventTypes`, used by readers that only ever want
   *  a fixed, known set (e.g. the AI config changelog). Ignored when
   *  `eventType` is also set. */
  eventTypes?: AuditEventType[]
  actorUserId?: UserId
  /** Substring match against the denormalised `actor_email` column,
   *  case-insensitive. Trimmed and lower-cased here. */
  actorEmail?: string
  from?: Date
  to?: Date
  /** Event types to exclude. Ignored when `eventType` or `eventTypes` is
   *  set — a deliberate selection always wins over the default-hide
   *  behaviour. */
  excludeEventTypes?: string[]
  limit: number
}

/**
 * Shared row query behind every audit-log reader: the paginated admin feed
 * (listAuditEventsFn) and the AI config changelog (getAssistantConfigChangelogFn).
 *
 * No auth in here — each caller holds its own `requireAuth` gate, on
 * different permissions, before calling in. Do not add one here; it would
 * force both readers onto the same permission.
 */
export async function queryAuditEvents(filters: QueryAuditEventsFilters): Promise<AuditEventRow[]> {
  const conditions: SQL[] = []
  if (filters.eventType) conditions.push(eq(auditLog.eventType, filters.eventType))
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    conditions.push(inArray(auditLog.eventType, filters.eventTypes))
  }
  if (filters.actorUserId) conditions.push(eq(auditLog.actorUserId, filters.actorUserId))
  if (filters.actorEmail) {
    conditions.push(ilike(auditLog.actorEmail, `%${filters.actorEmail.trim().toLowerCase()}%`))
  }
  if (filters.from) conditions.push(gte(auditLog.occurredAt, filters.from))
  if (filters.to) conditions.push(lte(auditLog.occurredAt, filters.to))
  if (
    !filters.eventType &&
    !filters.eventTypes &&
    filters.excludeEventTypes &&
    filters.excludeEventTypes.length > 0
  ) {
    conditions.push(notInArray(auditLog.eventType, filters.excludeEventTypes))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const rows = await db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.occurredAt))
    .limit(filters.limit)

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
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
}

/** Cap on the `metadata.reason` extracted from thrown errors. */
const MAX_REASON_LEN = 200

/**
 * Default retention for audit-log rows. 365 days covers SOC2's
 * one-year minimum with no extra work for operators. Self-hosters
 * can override via the `auditLogRetentionDays` field on
 * `settings.audit_config` (added below). 0 = keep forever.
 */
export const DEFAULT_AUDIT_RETENTION_DAYS = 365

/**
 * Delete audit_log rows older than the configured retention window.
 * Single SQL DELETE, indexed by occurred_at DESC so the work is
 * bounded. Returns the number of rows deleted.
 *
 * Called from `startup.ts` daily (with a 30s post-boot delay).
 * Idempotent and concurrency-safe — concurrent runs in the unlikely
 * event of two pods racing each other simply delete fewer rows in
 * each.
 */
export async function pruneAuditLog(opts?: { retentionDays?: number }): Promise<number> {
  const retentionDays = opts?.retentionDays ?? DEFAULT_AUDIT_RETENTION_DAYS
  if (retentionDays <= 0) return 0

  const { db } = await import('@/lib/server/db')
  const { sql } = await import('drizzle-orm')

  const result = (await db.execute(sql`
    DELETE FROM "audit_log"
    WHERE "occurred_at" < now() - ${`${retentionDays} days`}::interval
  `)) as unknown as { count?: number; length?: number }
  const deleted = result.count ?? result.length ?? 0
  if (deleted > 0) {
    log.info({ deleted_count: deleted, retention_days: retentionDays }, 'pruned audit rows')
  }
  return deleted
}

/**
 * Derive a stable, length-capped `reason` string from a thrown error.
 *
 * Prefers `error.code` (typed Quackback errors like ValidationError /
 * ForbiddenError set this to a stable identifier). Falls back to a
 * truncated `error.message` so messages don't leak full backtraces or
 * unbounded user input into the audit row.
 */
function extractReason(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code).slice(0, MAX_REASON_LEN)
  }
  if (error instanceof Error) {
    return error.message.slice(0, MAX_REASON_LEN)
  }
  return 'UNEXPECTED'
}

/**
 * Wrap a mutation with success/failure audit-log emission. Records a
 * success row on resolve and a failure row (with `reason` derived from
 * the error's `code` or message) on throw, then rethrows the original
 * error.
 */
export async function withAuditEvent<T>(
  spec: {
    event: AuditEventType
    actor: AuditActor
    target?: AuditTarget
    before?: unknown
    after?: unknown
    metadata?: Record<string, unknown>
    headers?: Headers
  },
  mutation: () => Promise<T>
): Promise<T> {
  try {
    const result = await mutation()
    await recordAuditEvent({
      event: spec.event,
      outcome: 'success',
      actor: spec.actor,
      target: spec.target,
      before: spec.before,
      after: spec.after,
      metadata: spec.metadata,
      headers: spec.headers,
    })
    return result
  } catch (error) {
    await recordAuditEvent({
      event: spec.event,
      outcome: 'failure',
      actor: spec.actor,
      target: spec.target,
      before: spec.before,
      after: spec.after,
      metadata: { ...(spec.metadata ?? {}), reason: extractReason(error) },
      headers: spec.headers,
    })
    throw error
  }
}
