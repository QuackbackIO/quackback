/**
 * Pending actions — a write-tool call Quinn proposed but has not executed,
 * awaiting agent approval within a TTL. `proposePendingAction` opens one;
 * `decidePendingAction` moves it to `approved`/`rejected` (only from
 * `proposed`, and only before it expires); the stale-action sweep flips
 * unattended ones to `expired`. `executed`/`failed` land once an approved
 * action actually runs. `assistant_tool_calls.pending_action_id` links the
 * execution audit row back to the proposal that authorized it.
 *
 * `idempotencyKey` mirrors `assistant_tool_calls.idempotency_key` (same
 * `conversationId:latestCustomerMessageId:toolName:hash(args)` shape, see
 * assistant.tools.ts's `resolveIdempotencyKey`): a synthesis retry that
 * re-runs a write-tool call whose first attempt already proposed dedupes
 * onto that row via `proposePendingAction`'s INSERT ... ON CONFLICT DO
 * NOTHING instead of inserting a duplicate. The uniqueness only holds `WHERE
 * status = 'proposed'`, deliberately narrower than `assistant_tool_calls`'
 * key-alone index: this key does NOT uniquely identify a turn the way the
 * tool-call key does, because a copilot turn (surface: 'copilot') has no
 * customer message to key off and always threads `latestCustomerMessageId:
 * null`, so two unrelated copilot turns proposing the same tool with the
 * same args mint the identical key. Scoping to `status = 'proposed'` means
 * that collision only dedupes while the earlier proposal is still live (the
 * actual retry case this exists for, and an arguably-desirable merge of two
 * concurrent identical asks); once it is approved, rejected, expired, or
 * executed, the key is free again and a new, unrelated proposal is never
 * blocked from resurrecting a stale decision.
 *
 * `ticketId` (unified inbox §3.3) makes the parent polymorphic like
 * conversation_messages (conversation_messages_parent_check): a pending
 * action now hangs off a conversation XOR a ticket, so Quinn can propose a
 * write-tool call from a ticket-scoped copilot turn too.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { conversations } from './conversation'
import { tickets } from './tickets'
import { assistantInvolvements } from './assistant'
import { assistantRuns } from './assistant-runs'
import { principal } from './auth'

/**
 * Execution, as its own dimension (QUINN-PRODUCT P3).
 *
 * A review decision is not an execution and an execution is not a customer
 * outcome. `status` above carries the decision; this carries what the durable
 * executor actually did. NULL means nothing has been dispatched, which is also
 * what every row that predates this column means.
 *
 * `unknown` is dispatched-but-unconfirmed: the effect may have happened, so it
 * is neither claimed as done nor resent.
 */
export const ASSISTANT_PENDING_ACTION_EXECUTION_STATES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'unknown',
] as const

export type AssistantPendingActionExecutionState =
  (typeof ASSISTANT_PENDING_ACTION_EXECUTION_STATES)[number]

export const ASSISTANT_PENDING_ACTION_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'expired',
  'executed',
  'failed',
] as const

export type AssistantPendingActionStatus = (typeof ASSISTANT_PENDING_ACTION_STATUSES)[number]

export const ASSISTANT_PENDING_ACTION_ORIGIN_ROLES = [
  'customer_support',
  'copilot_qa',
  'workspace_assistant',
] as const

export const assistantPendingActions = pgTable(
  'assistant_pending_actions',
  {
    id: typeIdWithDefault('assistant_action')('id').primaryKey(),
    // Polymorphic parent (§3.3): a pending action hangs off a conversation OR a
    // ticket. Both nullable at the column level; the exactly-one CHECK below
    // guarantees precisely one is set.
    conversationId: typeIdColumnNullable('conversation')('conversation_id').references(
      () => conversations.id,
      { onDelete: 'cascade' }
    ),
    ticketId: typeIdColumnNullable('ticket')('ticket_id').references(() => tickets.id, {
      onDelete: 'cascade',
    }),
    // FK declared explicitly below: the default generated name overflows
    // Postgres's 63-byte identifier limit and gets silently truncated, so the
    // TS schema must spell out the truncated name for the drift check to match.
    involvementId: typeIdColumnNullable('assistant_involvement')('involvement_id'),
    workspaceThreadKey: text('workspace_thread_key'),
    toolName: text('tool_name').notNull(),
    args: jsonb('args').$type<Record<string, unknown>>().notNull(),
    summary: text('summary').notNull(),
    originRole: text('origin_role', { enum: ASSISTANT_PENDING_ACTION_ORIGIN_ROLES })
      .notNull()
      .default('customer_support'),
    /**
     * The connector policy use this proposal was made under, and the policy
     * version in force at that moment. Both are NULL for a built-in tool and
     * for every proposal that predates the connection gate.
     *
     * The profile is immutable: approving a customer-origin request must
     * re-resolve the CUSTOMER policy, never the approver's own teammate one
     * (the spec's "keep the approval origin immutable"). The version lets the
     * approval executor tell "nothing changed" from "changed since proposal"
     * without diffing two policy maps.
     */
    originProfile: text('origin_profile', { enum: ['agent', 'copilot', 'workspace'] }),
    policyVersion: integer('policy_version'),
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
    idempotencyKey: text('idempotency_key'),
    /** The durable run that parked on this proposal, and the step it parked at. */
    runId: typeIdColumnNullable('assistant_run')('run_id').references(() => assistantRuns.id, {
      onDelete: 'set null',
    }),
    runStepKey: text('run_step_key'),
    /**
     * Who the action is being taken for: the customer whose request produced
     * it, or the teammate who asked. Never the approver, who is `decidedById`.
     */
    requestedById: typeIdColumnNullable('principal')('requested_by_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    /** The same logical action identity the receipt carries. */
    actionKey: text('action_key'),
    /**
     * The exact operation a reviewer is asked to approve. `argsDigest` and
     * `contractDigest` are taken at proposal time; `approvedArgsDigest` is
     * taken at the decision. The executor compares all three before it
     * dispatches, so a changed argument or a changed input contract needs a
     * fresh decision rather than riding the old one.
     */
    argsDigest: text('args_digest'),
    contractDigest: text('contract_digest'),
    approvedArgsDigest: text('approved_args_digest'),
    executionState: text('execution_state', {
      enum: ASSISTANT_PENDING_ACTION_EXECUTION_STATES,
    }),
    executionJobId: text('execution_job_id'),
    /** Why the pre-dispatch recheck refused, in the reviewer's words. */
    executionError: text('execution_error'),
    /**
     * Why a proposal stopped being decidable without anybody deciding it.
     * `status` cannot carry a new value without rewriting its CHECK, which no
     * migration here may replay, so a superseded proposal is `expired` with
     * `superseded:<reason>` recorded here and the UI reads this first.
     */
    disposition: text('disposition'),
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
    // partial so only live proposals are indexed. Narrowed to conversation_id
    // IS NOT NULL now that the parent is polymorphic (see ticket_proposed_idx
    // below for the ticket-parent counterpart).
    index('assistant_pending_actions_conversation_proposed_idx')
      .on(table.conversationId)
      .where(sql`${table.status} = 'proposed' AND ${table.conversationId} IS NOT NULL`),
    // Ticket-parent counterpart to the conversation index above.
    index('assistant_pending_actions_ticket_proposed_idx')
      .on(table.ticketId)
      .where(sql`${table.status} = 'proposed' AND ${table.ticketId} IS NOT NULL`),
    // Drives the Copilot usage report's actions-funnel date-range scan
    // (analytics/copilot-usage.ts), which has no status predicate in its
    // WHERE clause (the proposed/approved/rejected/expired split is a set of
    // FILTER'd counts inside one aggregate) — plain, not partial or
    // composite, since every row (regardless of status) is in scope.
    index('assistant_pending_actions_proposed_at_idx').on(table.proposedAt),
    // See the column comment above for why this is scoped to `status =
    // 'proposed'` rather than the key alone.
    uniqueIndex('assistant_pending_actions_idempotency_key_idx')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL AND ${table.status} = 'proposed'`),
    // Drives the recovery sweep over actions whose execution is still owed.
    index('assistant_pending_actions_execution_idx')
      .on(table.proposedAt)
      .where(sql`${table.executionState} IN ('queued', 'running', 'unknown')`),
    check(
      'assistant_pending_actions_status_check',
      sql`${table.status} IN ('proposed','approved','rejected','expired','executed','failed')`
    ),
    // Exactly one parent: a pending action belongs to a conversation XOR a ticket.
    check(
      'assistant_pending_actions_parent_check',
      sql`num_nonnulls(${table.conversationId}, ${table.ticketId}, ${table.workspaceThreadKey}) = 1`
    ),
  ]
)

export const assistantPendingActionsRelations = relations(assistantPendingActions, ({ one }) => ({
  conversation: one(conversations, {
    fields: [assistantPendingActions.conversationId],
    references: [conversations.id],
  }),
  ticket: one(tickets, {
    fields: [assistantPendingActions.ticketId],
    references: [tickets.id],
  }),
  involvement: one(assistantInvolvements, {
    fields: [assistantPendingActions.involvementId],
    references: [assistantInvolvements.id],
  }),
}))
