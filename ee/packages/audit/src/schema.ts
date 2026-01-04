/**
 * Audit Log Database Schema
 *
 * This schema is kept separate from the main DB schema
 * to maintain clean EE/OSS separation.
 */

import { pgTable, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core'

/**
 * Audit log entry types
 */
export type AuditEventCategory =
  | 'auth'
  | 'user'
  | 'team'
  | 'post'
  | 'comment'
  | 'board'
  | 'settings'
  | 'integration'
  | 'export'
  | 'admin'

/**
 * Audit logs table
 *
 * Stores all auditable events for compliance reporting.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(), // audit_xxx
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),

    // Actor information
    actorId: text('actor_id'), // user_xxx or null for system
    actorEmail: text('actor_email'),
    actorName: text('actor_name'),
    actorIp: text('actor_ip'),
    actorUserAgent: text('actor_user_agent'),

    // Event information
    category: text('category').notNull().$type<AuditEventCategory>(),
    action: text('action').notNull(), // e.g., 'login', 'create', 'update', 'delete'
    description: text('description'),

    // Target resource
    resourceType: text('resource_type'), // e.g., 'user', 'post', 'board'
    resourceId: text('resource_id'),
    resourceName: text('resource_name'),

    // Additional context
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    // Change tracking (for updates)
    previousState: jsonb('previous_state').$type<Record<string, unknown>>(),
    newState: jsonb('new_state').$type<Record<string, unknown>>(),

    // Result
    success: text('success').notNull().$type<'success' | 'failure'>(),
    errorMessage: text('error_message'),
  },
  (table) => [
    index('audit_logs_timestamp_idx').on(table.timestamp),
    index('audit_logs_actor_id_idx').on(table.actorId),
    index('audit_logs_category_idx').on(table.category),
    index('audit_logs_resource_idx').on(table.resourceType, table.resourceId),
  ]
)

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
