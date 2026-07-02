/**
 * Workspace-wide append-only audit log.
 *
 * Distinct from `post_activity` (per-post timeline) and `ticket_activity`
 * (per-ticket timeline, added in Phase 3): this table records security- and
 * admin-relevant events across the entire workspace — role grants, permission
 * edits, ticket shares, exports, API key actions, settings changes.
 *
 * The table is intentionally append-only: there is no UPDATE or DELETE path
 * exposed by the audit domain. Schema changes that need to redact entries
 * should add a new event rather than mutate history.
 */
import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'

/**
 * Source of the actor — UI, API key, integration, system.
 */
export type AuditSource = 'web' | 'api' | 'integration' | 'system' | 'mcp'

/**
 * JSON-serialisable scalar / container for audit diffs. Constrains the value
 * type to what TanStack Start's RPC layer can serialise so audit rows can
 * round-trip through server functions without extra encoding.
 */
export type AuditJsonValue =
  | string
  | number
  | boolean
  | null
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue }

export interface AuditDiff {
  /** Field-level before/after maps. */
  before?: Record<string, AuditJsonValue>
  after?: Record<string, AuditJsonValue>
  /** Free-form additional context (e.g. share level, ticket scope). */
  context?: Record<string, AuditJsonValue>
}

export const auditEvents = pgTable(
  'audit_events',
  {
    id: typeIdWithDefault('audit')('id').primaryKey(),
    /** Actor that performed the action; NULL = system / cron / migration. */
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    /** Dotted action key, e.g. "role.granted", "ticket.shared", "api_key.rotated". */
    action: text('action').notNull(),
    /** Type of the target resource (e.g. "ticket", "team", "api_key"). */
    targetType: text('target_type').notNull(),
    /** TypeID of the target; stored as text to avoid hard-coupling to one prefix. */
    targetId: text('target_id'),
    /** Structured diff: before/after/context. */
    diff: jsonb('diff').$type<AuditDiff>().notNull().default({}),
    source: text('source').$type<AuditSource>().notNull().default('web'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('audit_events_created_at_idx').on(t.createdAt),
    index('audit_events_principal_idx').on(t.principalId, t.createdAt),
    index('audit_events_action_idx').on(t.action, t.createdAt),
    index('audit_events_target_idx').on(t.targetType, t.targetId),
  ]
)
