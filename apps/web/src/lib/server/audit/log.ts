/**
 * Append-only audit log helper.
 *
 * One call per security-sensitive admin action. Best-effort: insert
 * failures are logged and swallowed so the primary mutation isn't
 * blocked by audit-log downtime. Callers must not rely on the row
 * being visible to a subsequent SELECT in the same transaction —
 * inserts are made on the global connection, not the caller's tx.
 */
import { db, auditLog } from '@/lib/server/db'
import type { UserId } from '@quackback/ids'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'

/** A JSON-shaped value — fits into a Postgres jsonb column. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [key: string]: JsonValue }
  | JsonValue[]

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
  | 'two_factor.reset_by_admin'
  | 'two_factor.enabled'
  | 'two_factor.disabled'
  // v1 access controls
  | 'board.audience.changed'
  | 'moderation.default.changed'
  | 'portal.visibility.changed'
  | 'portal.allowed_domains.changed'
  | 'post.moderation.approved'
  | 'post.moderation.rejected'
  | 'post.moderation.held'
  | 'segment.member.added'
  | 'segment.member.removed'
  | 'segment.sso_mapping.changed'
  // v1 portal invites
  | 'portal.invite.sent'
  | 'portal.invite.accepted'
  | 'portal.invite.revoked'
  // v1 portal widget sign-in handshake
  | 'portal.widget_handshake.consumed'
  | 'portal.widget_handshake.invalid'
  // v1 portal widget sign-in toggle
  | 'portal.widget_signin.changed'

export type AuditEventOutcome = 'success' | 'failure'

export interface AuditActor {
  userId?: UserId | null
  email?: string | null
  role?: string | null
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
  return { userId: auth.user.id, email: auth.user.email, role: auth.principal.role }
}

export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  const ip = input.headers ? getClientIp(input.headers) : null
  const userAgent = input.headers?.get('user-agent') ?? null

  try {
    await db.insert(auditLog).values({
      eventType: input.event,
      eventOutcome: input.outcome ?? 'success',
      actorUserId: input.actor.userId ?? null,
      actorEmail: input.actor.email ?? null,
      actorRole: input.actor.role ?? null,
      actorIp: ip === 'unknown' ? null : ip,
      actorUserAgent: userAgent,
      targetType: input.target?.type ?? null,
      targetId: input.target?.id ?? null,
      beforeValue: input.before ?? null,
      afterValue: input.after ?? null,
      metadata: input.metadata ?? null,
    })
  } catch (error) {
    console.error('[audit] recordAuditEvent failed:', { event: input.event, error })
  }
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
    console.log(`[audit] pruned ${deleted} rows older than ${retentionDays} days`)
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
