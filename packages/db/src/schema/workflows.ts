/**
 * Workflows engine (support platform §4.6). One trigger + a JSONB graph of
 * condition/branch/action/wait nodes. `class` drives execution: customer_facing
 * runs are exclusive per conversation (first match by sortOrder wins, locked
 * while running); background runs go in parallel. `workflow_runs.cursor` + a
 * BullMQ delayed job per wait is the durable state machine; `workflow_run_events`
 * is the audit + per-person frequency-cap ledger. Per-tenant DB, no workspace
 * column.
 */
import { pgTable, text, integer, jsonb, timestamp, index, foreignKey } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { conversations } from './conversation'

/** customer_facing = exclusive per conversation; background = parallel. */
export type WorkflowClass = 'customer_facing' | 'background'
/** draft = editable/inert, live = dispatching, paused = retained but inert. */
export type WorkflowStatus = 'draft' | 'live' | 'paused'
/** running -> waiting (durable) -> done, or interrupted by a reply/close. */
export type WorkflowRunState = 'running' | 'waiting' | 'done' | 'interrupted'

export const workflows = pgTable(
  'workflows',
  {
    id: typeIdWithDefault('workflow')('id').primaryKey(),
    name: text('name').notNull(),
    class: text('class').$type<WorkflowClass>().notNull(),
    status: text('status').$type<WorkflowStatus>().notNull().default('draft'),
    // Drag order; customer_facing first-match resolves ties by it. ('order' is a
    // reserved word, so the column is sort_order.)
    sortOrder: integer('sort_order').notNull().default(0),
    triggerType: text('trigger_type').notNull(),
    triggerSettings: jsonb('trigger_settings')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // The canvas: { nodes, edges }. Stored whole — the editor serializes it and no
    // query needs a single node cross-workflow. The app owns the shape.
    graph: jsonb('graph')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: typeIdColumnNullable('principal')('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'workflows_created_by_fkey',
      columns: [table.createdBy],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    index('workflows_trigger_status_order_idx').on(
      table.triggerType,
      table.status,
      table.sortOrder
    ),
  ]
)

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    id: typeIdWithDefault('workflow_run')('id').primaryKey(),
    workflowId: typeIdColumn('workflow')('workflow_id').notNull(),
    conversationId: typeIdColumnNullable('conversation')('conversation_id'),
    subjectPrincipalId: typeIdColumnNullable('principal')('subject_principal_id'),
    state: text('state').$type<WorkflowRunState>().notNull().default('running'),
    cursor: jsonb('cursor')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: 'workflow_runs_workflow_id_fkey',
      columns: [table.workflowId],
      foreignColumns: [workflows.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflow_runs_conversation_id_fkey',
      columns: [table.conversationId],
      foreignColumns: [conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflow_runs_subject_principal_id_fkey',
      columns: [table.subjectPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    index('workflow_runs_conversation_state_idx')
      .on(table.conversationId, table.state)
      .where(sql`"conversation_id" IS NOT NULL`),
    index('workflow_runs_state_idx').on(table.state),
  ]
)

export const workflowRunEvents = pgTable(
  'workflow_run_events',
  {
    id: typeIdWithDefault('workflow_run_event')('id').primaryKey(),
    runId: typeIdColumn('workflow_run')('run_id').notNull(),
    workflowId: typeIdColumn('workflow')('workflow_id').notNull(),
    subjectPrincipalId: typeIdColumnNullable('principal')('subject_principal_id'),
    kind: text('kind').notNull(),
    at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: 'workflow_run_events_run_id_fkey',
      columns: [table.runId],
      foreignColumns: [workflowRuns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflow_run_events_workflow_id_fkey',
      columns: [table.workflowId],
      foreignColumns: [workflows.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'workflow_run_events_subject_principal_id_fkey',
      columns: [table.subjectPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    index('workflow_run_events_cap_idx').on(table.workflowId, table.subjectPrincipalId, table.at),
  ]
)

export type Workflow = typeof workflows.$inferSelect
export type WorkflowRun = typeof workflowRuns.$inferSelect
export type WorkflowRunEvent = typeof workflowRunEvents.$inferSelect
