/**
 * Regression cases: the improvement loop's own store (QUINN-PRODUCT P8).
 *
 * A teammate correcting one of Quinn's answers already produces an approved
 * snippet, which fixes the fact. This table is the other half the specification
 * asks for: the same correction kept as a case a release candidate is checked
 * against, so the fix is proved to still hold the next time the behaviour
 * changes.
 *
 * The expectation is STRUCTURAL and closed: answer, answer grounded on a named
 * source, or hand off. There is deliberately no free-text expected answer,
 * because grading one needs a model and a reviewed rubric that this step does
 * not have, and a check that cannot say why it failed teaches people to ignore
 * the gate.
 *
 * The question is a copy of what a customer wrote, so `conversationId` and
 * `messageId` CASCADE: deleting a customer's history takes the case with it.
 */
import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { principal } from './auth'
import { conversations, conversationMessages } from './conversation'
import { assistantRuns } from './assistant-runs'

/**
 * What a candidate has to do with the question.
 *
 * `cites_source` is the one a correction usually produces: the corrected fact
 * was written down as a source, so the candidate must ground on it rather than
 * merely say something plausible.
 */
export const ASSISTANT_REGRESSION_EXPECTATIONS = ['answers', 'cites_source', 'hands_off'] as const
export type AssistantRegressionExpectation = (typeof ASSISTANT_REGRESSION_EXPECTATIONS)[number]

/** Where the case came from: captured out of a real correction, or written by hand. */
export const ASSISTANT_REGRESSION_ORIGINS = ['answer_correction', 'manual'] as const
export type AssistantRegressionOrigin = (typeof ASSISTANT_REGRESSION_ORIGINS)[number]

export const assistantRegressionCases = pgTable(
  'assistant_regression_cases',
  {
    id: typeIdWithDefault('assistant_regression_case')('id').primaryKey(),
    title: text('title').notNull(),
    /** What was asked, as asked. */
    question: text('question').notNull(),
    expectation: text('expectation').$type<AssistantRegressionExpectation>().notNull(),
    expectedSourceType: text('expected_source_type'),
    expectedSourceId: text('expected_source_id'),
    /** What the teammate said the right answer was. Shown on a failure, never graded. */
    correctionNote: text('correction_note'),
    enabled: boolean('enabled').notNull().default(true),
    origin: text('origin')
      .$type<AssistantRegressionOrigin>()
      .notNull()
      .default('answer_correction'),
    conversationId: typeIdColumnNullable('conversation')('conversation_id'),
    messageId: typeIdColumnNullable('conversation_msg')('message_id'),
    runId: typeIdColumnNullable('assistant_run')('run_id'),
    // Nulled on the author's deletion — the case outlives them.
    createdByPrincipalId: typeIdColumnNullable('principal')('created_by_principal_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Every foreign key is named explicitly: drizzle's derived names for this
    // table run past PostgreSQL's 63-character identifier limit and come back
    // truncated, which the drift check reads as drift.
    foreignKey({
      name: 'assistant_regression_cases_conversation_id_fkey',
      columns: [table.conversationId],
      foreignColumns: [conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assistant_regression_cases_message_id_fkey',
      columns: [table.messageId],
      foreignColumns: [conversationMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assistant_regression_cases_run_id_fkey',
      columns: [table.runId],
      foreignColumns: [assistantRuns.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'assistant_regression_cases_created_by_fkey',
      columns: [table.createdByPrincipalId],
      foreignColumns: [principal.id],
    }).onDelete('set null'),
    // Adding the same corrected message twice is the same case.
    uniqueIndex('assistant_regression_cases_message_uidx')
      .on(table.messageId)
      .where(sql`${table.messageId} IS NOT NULL`),
    index('assistant_regression_cases_enabled_idx').on(table.enabled, table.createdAt),
    check(
      'assistant_regression_cases_expectation_check',
      sql`${table.expectation} IN ('answers', 'cites_source', 'hands_off')`
    ),
    check(
      'assistant_regression_cases_origin_check',
      sql`${table.origin} IN ('answer_correction', 'manual')`
    ),
    check(
      'assistant_regression_cases_title_length_check',
      sql`char_length(${table.title}) BETWEEN 1 AND 120`
    ),
    check(
      'assistant_regression_cases_question_length_check',
      sql`char_length(${table.question}) BETWEEN 1 AND 2000`
    ),
    check(
      'assistant_regression_cases_note_length_check',
      sql`${table.correctionNote} IS NULL OR char_length(${table.correctionNote}) <= 4000`
    ),
    check(
      'assistant_regression_cases_source_check',
      sql`(${table.expectation} = 'cites_source' AND ${table.expectedSourceType} IS NOT NULL AND ${table.expectedSourceId} IS NOT NULL)
          OR (${table.expectation} <> 'cites_source' AND ${table.expectedSourceType} IS NULL AND ${table.expectedSourceId} IS NULL)`
    ),
  ]
)

export type AssistantRegressionCase = typeof assistantRegressionCases.$inferSelect

export const assistantRegressionCasesRelations = relations(assistantRegressionCases, ({ one }) => ({
  conversation: one(conversations, {
    fields: [assistantRegressionCases.conversationId],
    references: [conversations.id],
  }),
  run: one(assistantRuns, {
    fields: [assistantRegressionCases.runId],
    references: [assistantRuns.id],
  }),
}))
