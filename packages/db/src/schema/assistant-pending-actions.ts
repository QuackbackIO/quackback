/**
 * Pending actions — a write-tool call Quinn proposed but has not executed,
 * awaiting agent approval within a TTL. `proposePendingAction` opens one;
 * `decidePendingAction` moves it to `approved`/`rejected` (only from
 * `proposed`, and only before it expires); the stale-action sweep flips
 * unattended ones to `expired`. `executed`/`failed` land once an approved
 * action actually runs. `assistant_tool_calls.pending_action_id` links the
 * execution audit row back to the proposal that authorized it.
 */
import { pgTable, text, timestamp, jsonb, index, check, foreignKey } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { conversations } from './conversation'
import { assistantInvolvements } from './assistant'
import { principal } from './auth'

export const ASSISTANT_PENDING_ACTION_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'expired',
  'executed',
  'failed',
] as const

export type AssistantPendingActionStatus = (typeof ASSISTANT_PENDING_ACTION_STATUSES)[number]

export const assistantPendingActions = pgTable(
  'assistant_pending_actions',
  {
    id: typeIdWithDefault('assistant_action')('id').primaryKey(),
    conversationId: typeIdColumn('conversation')('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    // FK declared explicitly below: the default generated name overflows
    // Postgres's 63-byte identifier limit and gets silently truncated, so the
    // TS schema must spell out the truncated name for the drift check to match.
    involvementId: typeIdColumnNullable('assistant_involvement')('involvement_id'),
    toolName: text('tool_name').notNull(),
    args: jsonb('args').$type<Record<string, unknown>>().notNull(),
    summary: text('summary').notNull(),
    status: text('status', { enum: ASSISTANT_PENDING_ACTION_STATUSES })
      .notNull()
      .default('proposed'),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedById: typeIdColumnNullable('principal')('decided_by_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    result: jsonb('result').$type<Record<string, unknown> | null>(),
  },
  (table) => [
    foreignKey({
      // Truncated from assistant_pending_actions_involvement_id_assistant_involvements_id_fk
      // (see the comment on the column above).
      name: 'assistant_pending_actions_involvement_id_assistant_involvements',
      columns: [table.involvementId],
      foreignColumns: [assistantInvolvements.id],
    }).onDelete('set null'),
    // Drives "does this conversation have an outstanding proposal" lookups;
    // partial so only live proposals are indexed.
    index('assistant_pending_actions_conversation_proposed_idx')
      .on(table.conversationId)
      .where(sql`${table.status} = 'proposed'`),
    check(
      'assistant_pending_actions_status_check',
      sql`${table.status} IN ('proposed','approved','rejected','expired','executed','failed')`
    ),
  ]
)

export const assistantPendingActionsRelations = relations(assistantPendingActions, ({ one }) => ({
  conversation: one(conversations, {
    fields: [assistantPendingActions.conversationId],
    references: [conversations.id],
  }),
  involvement: one(assistantInvolvements, {
    fields: [assistantPendingActions.involvementId],
    references: [assistantInvolvements.id],
  }),
}))
