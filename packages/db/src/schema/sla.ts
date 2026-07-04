/**
 * SLA policies + events (support platform §4.6). Named reusable policies applied
 * ONLY via the Apply-SLA workflow action; clocks are office-hours-aware. The
 * `sla_events` log is the append-only breach/response timeline the lazy breach
 * evaluator reads. Per-tenant DB, so no workspace column.
 */
import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { officeHoursSchedules } from './office-hours'
import { conversations } from './conversation'

export const slaPolicies = pgTable(
  'sla_policies',
  {
    id: typeIdWithDefault('sla_policy')('id').primaryKey(),
    name: text('name').notNull(),
    firstResponseTargetSecs: integer('first_response_target_secs'),
    nextResponseTargetSecs: integer('next_response_target_secs'),
    timeToCloseTargetSecs: integer('time_to_close_target_secs'),
    pauseOnSnooze: boolean('pause_on_snooze').notNull().default(true),
    officeHoursScheduleId: typeIdColumnNullable('office_hours')('office_hours_schedule_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'sla_policies_office_hours_schedule_id_fkey',
      columns: [table.officeHoursScheduleId],
      foreignColumns: [officeHoursSchedules.id],
    }).onDelete('set null'),
  ]
)

export const slaEvents = pgTable(
  'sla_events',
  {
    id: typeIdWithDefault('sla_event')('id').primaryKey(),
    conversationId: typeIdColumn('conversation')('conversation_id').notNull(),
    policyId: typeIdColumn('sla_policy')('policy_id').notNull(),
    kind: text('kind').notNull(),
    meta: jsonb('meta')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'sla_events_conversation_id_fkey',
      columns: [table.conversationId],
      foreignColumns: [conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'sla_events_policy_id_fkey',
      columns: [table.policyId],
      foreignColumns: [slaPolicies.id],
    }).onDelete('restrict'),
    index('sla_events_conversation_at_idx').on(table.conversationId, table.at),
  ]
)

export type SlaPolicy = typeof slaPolicies.$inferSelect
export type SlaEvent = typeof slaEvents.$inferSelect
