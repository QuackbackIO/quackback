/**
 * Tool-call audit log — one row per assistant tool invocation. `claimToolCall`
 * inserts the `started` row via INSERT ... ON CONFLICT DO NOTHING on the
 * partial-unique idempotency index, so a retried call (BullMQ redelivery, a
 * duplicated LLM turn) never re-runs its side-effect; a NULL idempotency key
 * never conflicts with another NULL. `finalizeToolCall` fills in the terminal
 * status once the call settles; `recordDeniedToolCall` writes a denial
 * directly since a denied call never attempts its side-effect and needs no
 * claim.
 */
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { conversations } from './conversation'
import { assistantInvolvements } from './assistant'
import { assistantPendingActions } from './assistant-pending-actions'
import { principal } from './auth'

export const ASSISTANT_TOOL_CALL_STATUSES = [
  'started',
  'succeeded',
  'failed',
  'denied',
  'skipped_duplicate',
] as const

export type AssistantToolCallStatus = (typeof ASSISTANT_TOOL_CALL_STATUSES)[number]

export const assistantToolCalls = pgTable(
  'assistant_tool_calls',
  {
    id: typeIdWithDefault('assistant_tool_call')('id').primaryKey(),
    conversationId: typeIdColumnNullable('conversation')('conversation_id').references(
      () => conversations.id,
      { onDelete: 'cascade' }
    ),
    // Both FKs below are declared explicitly in the table config: their
    // default generated names overflow Postgres's 63-byte identifier limit
    // and get silently truncated, so the TS schema must spell out the
    // truncated name for the drift check to match.
    involvementId: typeIdColumnNullable('assistant_involvement')('involvement_id'),
    pendingActionId: typeIdColumnNullable('assistant_action')('pending_action_id'),
    toolName: text('tool_name').notNull(),
    args: jsonb('args').$type<Record<string, unknown>>().notNull(),
    status: text('status', { enum: ASSISTANT_TOOL_CALL_STATUSES }).notNull().default('started'),
    resultSummary: text('result_summary'),
    error: text('error'),
    latencyMs: integer('latency_ms'),
    idempotencyKey: text('idempotency_key'),
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      // Truncated from assistant_tool_calls_involvement_id_assistant_involvements_id_fk.
      name: 'assistant_tool_calls_involvement_id_assistant_involvements_id_f',
      columns: [table.involvementId],
      foreignColumns: [assistantInvolvements.id],
    }).onDelete('set null'),
    foreignKey({
      // Truncated from assistant_tool_calls_pending_action_id_assistant_pending_actions_id_fk.
      name: 'assistant_tool_calls_pending_action_id_assistant_pending_action',
      columns: [table.pendingActionId],
      foreignColumns: [assistantPendingActions.id],
    }).onDelete('set null'),
    index('assistant_tool_calls_conversation_id_created_at_idx').on(
      table.conversationId,
      table.createdAt
    ),
    // Partial so two NULL idempotency keys (calls with no stable key) never conflict.
    uniqueIndex('assistant_tool_calls_idempotency_key_idx')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    check(
      'assistant_tool_calls_status_check',
      sql`${table.status} IN ('started','succeeded','failed','denied','skipped_duplicate')`
    ),
  ]
)

export const assistantToolCallsRelations = relations(assistantToolCalls, ({ one }) => ({
  conversation: one(conversations, {
    fields: [assistantToolCalls.conversationId],
    references: [conversations.id],
  }),
  involvement: one(assistantInvolvements, {
    fields: [assistantToolCalls.involvementId],
    references: [assistantInvolvements.id],
  }),
  pendingAction: one(assistantPendingActions, {
    fields: [assistantToolCalls.pendingActionId],
    references: [assistantPendingActions.id],
  }),
}))
