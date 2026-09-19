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
  boolean,
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
import { assistantRuns } from './assistant-runs'
import { principal } from './auth'

export const ASSISTANT_TOOL_CALL_STATUSES = [
  'started',
  'succeeded',
  'failed',
  'denied',
  'skipped_duplicate',
] as const

export type AssistantToolCallStatus = (typeof ASSISTANT_TOOL_CALL_STATUSES)[number]

/**
 * The normalized outcome vocabulary (QUINN-PRODUCT P3), carried beside the
 * coarse `status` rather than inside it.
 *
 * `status` has a CHECK constraint listing its five values, and widening that
 * would need a DROP/ADD constraint pair no migration in this repository may
 * replay. Keeping the two columns separate is also what makes the older
 * readers safe: a reader that predates this column sees `started` for a
 * dispatched-but-unconfirmed effect, which is the honest coarse answer, and
 * can never mistake it for a success.
 *
 * `unknown` is the one that matters: the effect may or may not have happened,
 * so it is neither announced as done nor resent. It always carries
 * `reconciliation_state = 'required'`.
 */
export const ASSISTANT_TOOL_OUTCOME_STATUSES = [
  'succeeded',
  'denied',
  'pending_approval',
  'in_progress',
  'failed',
  'unknown',
] as const

export type AssistantToolOutcomeStatus = (typeof ASSISTANT_TOOL_OUTCOME_STATUSES)[number]

/** Whether a human still owes this receipt a verdict, and what they decided. */
export const ASSISTANT_TOOL_RECONCILIATION_STATES = ['required', 'resolved', 'failed'] as const

export type AssistantToolReconciliationState = (typeof ASSISTANT_TOOL_RECONCILIATION_STATES)[number]

/**
 * What a duplicate or interrupted call of this tool may do.
 *
 * - `local_transactional` the effect and this receipt commit together in this
 *   database, so there is no window in which one exists without the other.
 * - `external_idempotent` the effect leaves the database, but the provider
 *   accepts an idempotency key we supply, so a repeat is absorbed there.
 * - `external_uncertain` the effect leaves the database with no idempotency or
 *   status-query contract. An interrupted dispatch becomes `unknown` and waits
 *   for a person; it is never resent automatically.
 */
export const ASSISTANT_TOOL_REPLAY_STRATEGIES = [
  'local_transactional',
  'external_idempotent',
  'external_uncertain',
] as const

export type AssistantToolReplayStrategy = (typeof ASSISTANT_TOOL_REPLAY_STRATEGIES)[number]

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
    /** The durable run and step this effect belongs to, so it stays explainable. */
    runId: typeIdColumnNullable('assistant_run')('run_id').references(() => assistantRuns.id, {
      onDelete: 'set null',
    }),
    runStepKey: text('run_step_key'),
    /**
     * The stable logical identity of the business action: parent, engagement,
     * tool and canonical argument digest, or `pending:<id>` once a human
     * decision is itself the boundary. Deliberately NOT the model's tool-call
     * id or a job id, either of which is fresh on every continuation.
     */
    actionKey: text('action_key'),
    argsDigest: text('args_digest'),
    schemaDigest: text('schema_digest'),
    /** The bounded normalized value a duplicate call is answered with. */
    result: jsonb('result').$type<Record<string, unknown> | null>(),
    /** What the provider itself said: request id, echoed idempotency key. */
    providerReceipt: jsonb('provider_receipt').$type<Record<string, unknown> | null>(),
    providerIdempotencyKey: text('provider_idempotency_key'),
    /**
     * The intent was committed and the effect was attempted. Set with no
     * `settled_at` is the crash-after-effect case, which is `unknown`.
     */
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    outcomeStatus: text('outcome_status', { enum: ASSISTANT_TOOL_OUTCOME_STATUSES }),
    /** Only meaningful with `outcome_status = 'failed'`. */
    retryable: boolean('retryable'),
    reconciliationState: text('reconciliation_state', {
      enum: ASSISTANT_TOOL_RECONCILIATION_STATES,
    }),
    reconciliationNote: text('reconciliation_note'),
    reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
    reconciledById: typeIdColumnNullable('principal')('reconciled_by_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    replayStrategy: text('replay_strategy', { enum: ASSISTANT_TOOL_REPLAY_STRATEGIES }),
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
    // Drives the Quinn performance dashboard's succeeded-actions date-range scan.
    index('assistant_tool_calls_status_created_at_idx').on(table.status, table.createdAt),
    // Plain created_at: quinn-tools.ts's per-tool breakdown filters ONLY on
    // created_at (status is a FILTER inside the aggregate, not a WHERE
    // predicate), so the composite (status, created_at) index above can't
    // serve it — a range scan needs created_at as the index's leading column.
    // Also backs the 180-day retention sweep's DELETE ... WHERE created_at <
    // cutoff (usage-log.ts's cleanupExpiredLogs pattern, extended to this table).
    index('assistant_tool_calls_created_at_idx').on(table.createdAt),
    // Partial so two NULL idempotency keys (calls with no stable key) never conflict.
    uniqueIndex('assistant_tool_calls_idempotency_key_idx')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    // The logical-identity twin of the index above. The claim insert conflicts
    // on either, so two workers that computed the same business action cannot
    // both dispatch it even when their per-turn keys differ.
    uniqueIndex('assistant_tool_calls_action_key_idx')
      .on(table.actionKey)
      .where(sql`${table.actionKey} IS NOT NULL`),
    // The reconciliation queue: effects nobody can confirm yet.
    index('assistant_tool_calls_reconciliation_idx')
      .on(table.createdAt)
      .where(sql`${table.reconciliationState} = 'required'`),
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
