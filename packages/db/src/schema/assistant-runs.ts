/**
 * Durable Quinn execution records (QUINN-PRODUCT P1).
 *
 * These tables own ONE state machine and no other: "what computation is running
 * for a particular durable input, and may it publish?". They deliberately do not
 * own who the customer is waiting on, whether the issue resolved, or which
 * business step comes next. Those remain `conversations` / `assistant_involvements`
 * and `workflow_runs`. A succeeded run is not a resolved conversation; a
 * clarification can succeed as a run while the customer still waits.
 *
 * The publication fence is a pair of numbers, not a lock held across a model
 * call. `conversations.assistant_revision` counts every input or authority
 * change; a run records the revision it was created for, and may only publish
 * while the two still agree. Every invalidation (a human reply, a takeover, a
 * close, a snooze, a spam filing, a newer customer message) bumps the
 * conversation counter inside its own transaction, so a generation that started
 * before it can no longer land, whether or not the provider honoured an abort.
 */
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  bigint as pgBigint,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { conversations, conversationMessages } from './conversation'
import { tickets } from './tickets'
import { principal } from './auth'
import { assistantInvolvements } from './assistant'

/**
 * Where a run is in its lifecycle.
 *
 * `superseded` is a newer input winning; `suppressed` is the engine deciding
 * there was nothing to say; `cancelled` is authority withdrawn (takeover,
 * closure, rollback). All three are ordinary terminal states, not failures.
 */
export const ASSISTANT_RUN_STATUSES = [
  'queued',
  'running',
  'waiting_action',
  'succeeded',
  'suppressed',
  'superseded',
  'cancelled',
  'failed',
] as const

/** Which part of the turn the run reached. Diagnostic, never a fence. */
export const ASSISTANT_RUN_PHASES = ['context', 'generation', 'validation', 'publication'] as const

/**
 * What the run produced for the customer. Distinct from status: a succeeded run
 * may have produced a clarification, which is not an answer and must not start
 * the assumed-resolution clock.
 */
export const ASSISTANT_RUN_OUTCOMES = [
  'answer',
  'clarification',
  'greeting',
  'inability',
  'handoff',
  'resolution',
] as const

/** What created the run intent. */
export const ASSISTANT_RUN_TRIGGER_KINDS = [
  'customer_message',
  'workflow_delegation',
  'agent_handback',
] as const

/**
 * The product surface the run serves.
 *
 * `email` is a customer-facing turn on the support email channel, which only
 * exists once the workspace enables that channel for Quinn and the
 * conversation passes its eligibility rules (QUINN-PRODUCT P9). The column is
 * plain text with no CHECK, deliberately: the vocabulary is a TypeScript fact
 * and a new member must not need a constraint swap that cannot replay.
 */
export const ASSISTANT_RUN_SURFACES = ['widget', 'email', 'workflow_step'] as const

export type AssistantRunStatus = (typeof ASSISTANT_RUN_STATUSES)[number]
export type AssistantRunPhase = (typeof ASSISTANT_RUN_PHASES)[number]
export type AssistantRunOutcome = (typeof ASSISTANT_RUN_OUTCOMES)[number]
export type AssistantRunTriggerKind = (typeof ASSISTANT_RUN_TRIGGER_KINDS)[number]
export type AssistantRunSurface = (typeof ASSISTANT_RUN_SURFACES)[number]

/** Durable identity of the workflow wait a run answers, when one delegated it. */
export interface AssistantRunDelegation {
  workflowRunId: string
  nodeId: string
  waitSeq: number
}

/**
 * The immutable behaviour a run executed under.
 *
 * Deduplicated by `content_hash` because most runs in a quiet workspace resolve
 * to byte-identical behaviour, and because a stable hash is what lets an
 * operator say "these two runs behaved the same" without diffing blobs. Never
 * stores credentials: connector entries carry a contract fingerprint, never a
 * token, and the builder is the only writer.
 */
export const assistantEffectiveSnapshots = pgTable(
  'assistant_effective_snapshots',
  {
    id: typeIdWithDefault('assistant_snapshot')('id').primaryKey(),
    contentHash: text('content_hash').notNull(),
    /** Resolved config, prompt/build version, guidance and skill content versions, tool contract fingerprints, retrieval and validator settings. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('assistant_effective_snapshots_hash_idx').on(t.contentHash)]
)

export type AssistantEffectiveSnapshot = typeof assistantEffectiveSnapshots.$inferSelect

export const assistantRuns = pgTable(
  'assistant_runs',
  {
    id: typeIdWithDefault('assistant_run')('id').primaryKey(),
    // Exactly one live parent. `workspace_thread_key` covers a future
    // workspace/Slack thread that is neither a conversation nor a ticket; the
    // CHECK is what stops a run from belonging to two of them at once.
    conversationId: typeIdColumnNullable('conversation')('conversation_id').references(
      () => conversations.id,
      { onDelete: 'cascade' }
    ),
    ticketId: typeIdColumnNullable('ticket')('ticket_id').references(() => tickets.id, {
      onDelete: 'cascade',
    }),
    workspaceThreadKey: text('workspace_thread_key'),
    role: text('role').notNull().default('customer_support'),
    surface: text('surface', { enum: ASSISTANT_RUN_SURFACES }).notNull(),
    triggerKind: text('trigger_kind', { enum: ASSISTANT_RUN_TRIGGER_KINDS }).notNull(),
    /**
     * Stable business identity of the input this run answers. Unique, so a
     * retried intake resolves to the existing run instead of minting a second
     * one. Never a model-generated or job-generated id.
     */
    triggerKey: text('trigger_key').notNull(),
    triggerMessageId: typeIdColumnNullable('conversation_msg')('trigger_message_id').references(
      () => conversationMessages.id,
      { onDelete: 'set null' }
    ),
    delegation: jsonb('delegation').$type<AssistantRunDelegation>(),
    requestedByPrincipalId: typeIdColumnNullable('principal')(
      'requested_by_principal_id'
    ).references(() => principal.id, { onDelete: 'set null' }),
    involvementId: typeIdColumnNullable('assistant_involvement')('involvement_id').references(
      () => assistantInvolvements.id,
      { onDelete: 'set null' }
    ),
    snapshotId: typeIdColumnNullable('assistant_snapshot')('snapshot_id').references(
      () => assistantEffectiveSnapshots.id,
      { onDelete: 'set null' }
    ),
    status: text('status', { enum: ASSISTANT_RUN_STATUSES }).notNull().default('queued'),
    phase: text('phase', { enum: ASSISTANT_RUN_PHASES }).notNull().default('context'),
    outcome: text('outcome', { enum: ASSISTANT_RUN_OUTCOMES }),
    /** `conversations.assistant_revision` at intake. Publication requires it to still match. */
    inputRevision: pgBigint('input_revision', { mode: 'number' }).notNull().default(0),
    /** Incremented by every ownership transition, so a stale claimant loses a compare-and-set. */
    stateVersion: integer('state_version').notNull().default(0),
    /**
     * Diagnostic copies of the queue row's identity, deliberately plain text
     * with no foreign key: `job_queue` rows are pruned on their own retention
     * schedule and run history must outlive them. `job_lease_token` is also the
     * execution fence, compared under the conversation lock before any
     * consequential commit.
     */
    jobId: text('job_id'),
    jobLeaseToken: text('job_lease_token'),
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Bounded cost counters, for budget diagnostics rather than billing. */
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    resultMessageId: typeIdColumnNullable('conversation_msg')('result_message_id').references(
      () => conversationMessages.id,
      { onDelete: 'set null' }
    ),
    /** Why a run ended other than by answering. Free text, bounded by the caller. */
    errorReason: text('error_reason'),
    /** Machine-readable terminal disposition, e.g. `fence:input_revision`. */
    disposition: text('disposition'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'assistant_runs_parent_check',
      sql`num_nonnulls(${t.conversationId}, ${t.ticketId}, ${t.workspaceThreadKey}) = 1`
    ),
    uniqueIndex('assistant_runs_trigger_key_idx').on(t.triggerKey),
    // One executing run per conversation, enforced in PostgreSQL. This is a
    // backstop, not the fence: a dead run must stay recoverable, so the claim
    // also compares the input revision and the lease token.
    uniqueIndex('assistant_runs_one_executing_idx')
      .on(t.conversationId)
      .where(sql`${t.status} IN ('running', 'waiting_action') AND ${t.conversationId} IS NOT NULL`),
    index('assistant_runs_conversation_created_idx').on(t.conversationId, t.createdAt),
    // Leads on created_at, which the composite above cannot serve: the Improve
    // page scans a date range across every run, and the retention pass deletes
    // by age (QUINN-PRODUCT P8).
    index('assistant_runs_created_at_idx').on(t.createdAt),
    // The recovery sweep's scan: non-terminal runs, oldest first.
    index('assistant_runs_open_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} IN ('queued', 'running', 'waiting_action')`),
  ]
)

export type AssistantRun = typeof assistantRuns.$inferSelect

export const assistantRunsRelations = relations(assistantRuns, ({ one }) => ({
  conversation: one(conversations, {
    fields: [assistantRuns.conversationId],
    references: [conversations.id],
  }),
  involvement: one(assistantInvolvements, {
    fields: [assistantRuns.involvementId],
    references: [assistantInvolvements.id],
  }),
  snapshot: one(assistantEffectiveSnapshots, {
    fields: [assistantRuns.snapshotId],
    references: [assistantEffectiveSnapshots.id],
  }),
}))

/** What one step of a run did. `succeeded` here says the step ran, never that the turn resolved anything. */
export const ASSISTANT_RUN_STEP_STATUSES = ['started', 'succeeded', 'failed', 'skipped'] as const
export type AssistantRunStepStatus = (typeof ASSISTANT_RUN_STEP_STATUSES)[number]

export const assistantRunSteps = pgTable(
  'assistant_run_steps',
  {
    id: typeIdWithDefault('assistant_run_step')('id').primaryKey(),
    runId: typeIdColumn('assistant_run')('run_id')
      .notNull()
      .references(() => assistantRuns.id, { onDelete: 'cascade' }),
    /** Logical identity of the step within the run, stable across attempts. */
    stepKey: text('step_key').notNull(),
    attemptNumber: integer('attempt_number').notNull().default(1),
    stepKind: text('step_kind').notNull(),
    /** Digest of the step input, so drift between attempts is detectable without storing the input. */
    inputDigest: text('input_digest'),
    status: text('status', { enum: ASSISTANT_RUN_STEP_STATUSES }).notNull().default('started'),
    /** Bounded structured output. The caller truncates; this column is not a transcript. */
    output: jsonb('output').$type<Record<string, unknown>>(),
    modelId: text('model_id'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    /** Audit id of the tool receipt this step produced, when it called a tool. */
    toolCallId: text('tool_call_id'),
    validator: jsonb('validator').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('assistant_run_steps_identity_idx').on(t.runId, t.stepKey, t.attemptNumber),
    index('assistant_run_steps_run_idx').on(t.runId),
    // The retention sweep's own scan: steps past the window, by age.
    index('assistant_run_steps_started_at_idx').on(t.startedAt),
  ]
)

export type AssistantRunStep = typeof assistantRunSteps.$inferSelect

export const assistantRunEvidence = pgTable(
  'assistant_run_evidence',
  {
    id: typeIdWithDefault('assistant_run_evidence')('id').primaryKey(),
    runId: typeIdColumn('assistant_run')('run_id')
      .notNull()
      .references(() => assistantRuns.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull().default(1),
    /** Canonical citation source type (article, post, snippet, summary, ticket, changelog, document, webpage). */
    sourceType: text('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    /** Version or content hash of the source AS SUPPLIED, so later edits are detectable. */
    sourceVersion: text('source_version'),
    chunkId: text('chunk_id'),
    /** The passage actually handed to the model. Bounded and subject to the retention policy below. */
    passage: text('passage'),
    audience: text('audience'),
    provenance: text('provenance'),
    retrievalRank: integer('retrieval_rank'),
    rerankRank: integer('rerank_rank'),
    /** Which citation index in the published answer this evidence backs, when it was cited. */
    citationIndex: integer('citation_index'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('assistant_run_evidence_run_idx').on(t.runId, t.attemptNumber),
    index('assistant_run_evidence_source_idx').on(t.sourceType, t.sourceId),
    // The retention sweep's own scan: evidence past the window, by age.
    index('assistant_run_evidence_created_at_idx').on(t.createdAt),
  ]
)

export type AssistantRunEvidence = typeof assistantRunEvidence.$inferSelect

/**
 * HTTP retry receipts for the visitor send contract.
 *
 * A transport retry is a different boundary from a durable turn: the run
 * dedupes "one outcome per persisted trigger", this dedupes "one persisted
 * trigger per client attempt". The receipt is claimed in the same transaction
 * as the message insert, so a client that retries without a conversation id
 * cannot create a second conversation. Bound to a request digest: the same key
 * with different content is a client bug and is rejected rather than silently
 * answered with somebody else's identities.
 */
export const assistantRequestReceipts = pgTable(
  'assistant_request_receipts',
  {
    id: typeIdWithDefault('assistant_request_receipt')('id').primaryKey(),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    clientMutationId: text('client_mutation_id').notNull(),
    requestDigest: text('request_digest').notNull(),
    conversationId: typeIdColumnNullable('conversation')('conversation_id').references(
      () => conversations.id,
      { onDelete: 'cascade' }
    ),
    messageId: typeIdColumnNullable('conversation_msg')('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Named explicitly: drizzle's derived name for this one is 65 characters,
    // and PostgreSQL silently truncates identifiers at 63, which reads as
    // permanent schema drift.
    foreignKey({
      name: 'assistant_request_receipts_message_id_fkey',
      columns: [t.messageId],
      foreignColumns: [conversationMessages.id],
    }).onDelete('cascade'),
    uniqueIndex('assistant_request_receipts_key_idx').on(t.principalId, t.clientMutationId),
    index('assistant_request_receipts_created_idx').on(t.createdAt),
  ]
)

export type AssistantRequestReceipt = typeof assistantRequestReceipts.$inferSelect
