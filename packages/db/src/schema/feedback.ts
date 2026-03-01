import {
  pgTable,
  text,
  varchar,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  customType,
  real,
  boolean,
  check,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'
import { integrations } from './integrations'
import { boards } from './boards'
import { posts } from './posts'
import { principal } from './auth'
import type {
  RawFeedbackAuthor,
  RawFeedbackContent,
  RawFeedbackItemContextEnvelope,
} from '../types'

// pgvector 1536 dimensions = OpenAI text-embedding-3-small
const vector1536 = customType<{ data: number[] }>({ dataType: () => 'vector(1536)' })

// ============================================
// Feedback Sources
// ============================================

export const feedbackSources = pgTable(
  'feedback_sources',
  {
    id: typeIdWithDefault('feedback_source')('id').primaryKey(),
    sourceType: varchar('source_type', { length: 40 }).notNull(),
    deliveryMode: varchar('delivery_mode', { length: 20 }).notNull(),
    name: text('name').notNull(),
    integrationId: typeIdColumnNullable('integration')('integration_id').references(
      () => integrations.id,
      { onDelete: 'set null' }
    ),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    secrets: text('secrets'), // encrypted via 'feedback-source-secrets' purpose (AES-256-GCM + HKDF)
    cursor: text('cursor'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    errorCount: integer('error_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('feedback_sources_type_idx').on(t.sourceType),
    index('feedback_sources_enabled_idx').on(t.enabled),
    check('feedback_sources_error_count_non_negative', sql`error_count >= 0`),
  ]
)

// ============================================
// Raw Feedback Items
// ============================================

export const rawFeedbackItems = pgTable(
  'raw_feedback_items',
  {
    id: typeIdWithDefault('raw_feedback')('id').primaryKey(),
    sourceId: typeIdColumn('feedback_source')('source_id')
      .notNull()
      .references(() => feedbackSources.id, { onDelete: 'cascade' }),
    sourceType: varchar('source_type', { length: 40 }).notNull(),
    externalId: text('external_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    externalUrl: text('external_url'),
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }).notNull(),
    author: jsonb('author').$type<RawFeedbackAuthor>().notNull(),
    content: jsonb('content').$type<RawFeedbackContent>().notNull(),
    contextEnvelope: jsonb('context_envelope')
      .$type<RawFeedbackItemContextEnvelope>()
      .notNull()
      .default({}),
    processingState: varchar('processing_state', { length: 30 })
      .notNull()
      .default('pending_context'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    principalId: typeIdColumnNullable('principal')('principal_id').references(() => principal.id, {
      onDelete: 'set null',
    }),
    extractionInputTokens: integer('extraction_input_tokens'),
    extractionOutputTokens: integer('extraction_output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('raw_feedback_dedupe_idx').on(t.sourceId, t.dedupeKey),
    index('raw_feedback_state_idx').on(t.processingState),
    index('raw_feedback_source_type_idx').on(t.sourceType),
    index('raw_feedback_created_idx').on(t.createdAt),
  ]
)

// ============================================
// Feedback Signals
// ============================================

export const feedbackSignals = pgTable(
  'feedback_signals',
  {
    id: typeIdWithDefault('feedback_signal')('id').primaryKey(),
    rawFeedbackItemId: typeIdColumn('raw_feedback')('raw_feedback_item_id')
      .notNull()
      .references(() => rawFeedbackItems.id, { onDelete: 'cascade' }),
    signalType: varchar('signal_type', { length: 30 }).notNull(),
    summary: text('summary').notNull(),
    evidence: jsonb('evidence').$type<string[]>().notNull().default([]),
    implicitNeed: text('implicit_need'),
    sentiment: varchar('sentiment', { length: 10 }),
    urgency: varchar('urgency', { length: 10 }),
    boardId: typeIdColumnNullable('board')('board_id').references(() => boards.id, {
      onDelete: 'set null',
    }),
    extractionConfidence: real('extraction_confidence').notNull(),
    interpretationConfidence: real('interpretation_confidence'),
    embedding: vector1536('embedding'),
    embeddingModel: text('embedding_model'),
    embeddingUpdatedAt: timestamp('embedding_updated_at', { withTimezone: true }),
    processingState: varchar('processing_state', { length: 30 })
      .notNull()
      .default('pending_interpretation'),
    extractionModel: text('extraction_model'),
    extractionPromptVersion: varchar('extraction_prompt_version', { length: 20 }),
    interpretationModel: text('interpretation_model'),
    interpretationPromptVersion: varchar('interpretation_prompt_version', { length: 20 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('feedback_signals_raw_idx').on(t.rawFeedbackItemId),
    index('feedback_signals_board_idx').on(t.boardId),
    index('feedback_signals_state_idx').on(t.processingState),
    check(
      'extraction_confidence_range',
      sql`${t.extractionConfidence} >= 0 and ${t.extractionConfidence} <= 1`
    ),
  ]
)

// ============================================
// Feedback Suggestions
// ============================================

export const feedbackSuggestions = pgTable(
  'feedback_suggestions',
  {
    id: typeIdWithDefault('feedback_suggestion')('id').primaryKey(),
    suggestionType: varchar('suggestion_type', { length: 20 }).notNull(), // 'merge_post' | 'create_post'
    status: varchar('status', { length: 20 }).notNull().default('pending'), // 'pending' | 'accepted' | 'dismissed' | 'expired'
    rawFeedbackItemId: typeIdColumn('raw_feedback')('raw_feedback_item_id')
      .notNull()
      .references(() => rawFeedbackItems.id, { onDelete: 'cascade' }),
    signalId: typeIdColumnNullable('feedback_signal')('signal_id').references(
      () => feedbackSignals.id,
      { onDelete: 'set null' }
    ),
    boardId: typeIdColumnNullable('board')('board_id').references(() => boards.id, {
      onDelete: 'set null',
    }),
    targetPostId: typeIdColumnNullable('post')('target_post_id').references(() => posts.id, {
      onDelete: 'cascade',
    }),
    similarityScore: real('similarity_score'),
    suggestedTitle: text('suggested_title'),
    suggestedBody: text('suggested_body'),
    reasoning: text('reasoning'),
    embedding: vector1536('embedding'),
    resultPostId: typeIdColumnNullable('post')('result_post_id').references(() => posts.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByPrincipalId: typeIdColumnNullable('principal')('resolved_by_principal_id').references(
      () => principal.id,
      { onDelete: 'set null' }
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('feedback_suggestions_status_idx').on(t.status),
    index('feedback_suggestions_type_idx').on(t.suggestionType),
    index('feedback_suggestions_raw_item_idx').on(t.rawFeedbackItemId),
    index('feedback_suggestions_target_post_idx').on(t.targetPostId),
    index('feedback_suggestions_created_idx').on(t.createdAt),
    // Prevent duplicate pending merge suggestions for the same raw item + target post
    uniqueIndex('feedback_suggestions_pending_merge_idx')
      .on(t.rawFeedbackItemId, t.targetPostId)
      .where(sql`${t.status} = 'pending' AND ${t.targetPostId} IS NOT NULL`),
  ]
)

// ============================================
// Feedback Signal Corrections
// ============================================

export const feedbackSignalCorrections = pgTable(
  'feedback_signal_corrections',
  {
    id: typeIdWithDefault('signal_correction')('id').primaryKey(),
    signalId: typeIdColumn('feedback_signal')('signal_id')
      .notNull()
      .references(() => feedbackSignals.id, { onDelete: 'cascade' }),
    correctedByPrincipalId: typeIdColumn('principal')('corrected_by_principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    field: varchar('field', { length: 30 }).notNull(),
    previousValue: jsonb('previous_value').$type<unknown>(),
    newValue: jsonb('new_value').$type<unknown>().notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('feedback_signal_corrections_signal_idx').on(t.signalId)]
)

// ============================================
// External User Mappings
// ============================================

export const externalUserMappings = pgTable(
  'external_user_mappings',
  {
    id: typeIdWithDefault('user_mapping')('id').primaryKey(),
    sourceType: varchar('source_type', { length: 40 }).notNull(),
    externalUserId: text('external_user_id').notNull(),
    principalId: typeIdColumn('principal')('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    externalName: text('external_name'),
    externalEmail: text('external_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('external_user_source_idx').on(t.sourceType, t.externalUserId),
    index('external_user_principal_idx').on(t.principalId),
  ]
)

// ============================================
// Relations
// ============================================

export const feedbackSourcesRelations = relations(feedbackSources, ({ one, many }) => ({
  integration: one(integrations, {
    fields: [feedbackSources.integrationId],
    references: [integrations.id],
  }),
  rawItems: many(rawFeedbackItems),
}))

export const rawFeedbackItemsRelations = relations(rawFeedbackItems, ({ one, many }) => ({
  source: one(feedbackSources, {
    fields: [rawFeedbackItems.sourceId],
    references: [feedbackSources.id],
  }),
  resolvedPrincipal: one(principal, {
    fields: [rawFeedbackItems.principalId],
    references: [principal.id],
    relationName: 'rawFeedbackAuthor',
  }),
  signals: many(feedbackSignals),
}))

export const feedbackSuggestionsRelations = relations(feedbackSuggestions, ({ one }) => ({
  rawItem: one(rawFeedbackItems, {
    fields: [feedbackSuggestions.rawFeedbackItemId],
    references: [rawFeedbackItems.id],
  }),
  signal: one(feedbackSignals, {
    fields: [feedbackSuggestions.signalId],
    references: [feedbackSignals.id],
  }),
  board: one(boards, {
    fields: [feedbackSuggestions.boardId],
    references: [boards.id],
  }),
  targetPost: one(posts, {
    fields: [feedbackSuggestions.targetPostId],
    references: [posts.id],
    relationName: 'suggestionTarget',
  }),
  resultPost: one(posts, {
    fields: [feedbackSuggestions.resultPostId],
    references: [posts.id],
    relationName: 'suggestionResult',
  }),
  resolvedBy: one(principal, {
    fields: [feedbackSuggestions.resolvedByPrincipalId],
    references: [principal.id],
    relationName: 'suggestionResolver',
  }),
}))

export const feedbackSignalsRelations = relations(feedbackSignals, ({ one, many }) => ({
  rawItem: one(rawFeedbackItems, {
    fields: [feedbackSignals.rawFeedbackItemId],
    references: [rawFeedbackItems.id],
  }),
  board: one(boards, {
    fields: [feedbackSignals.boardId],
    references: [boards.id],
  }),
  corrections: many(feedbackSignalCorrections),
}))

export const feedbackSignalCorrectionsRelations = relations(
  feedbackSignalCorrections,
  ({ one }) => ({
    signal: one(feedbackSignals, {
      fields: [feedbackSignalCorrections.signalId],
      references: [feedbackSignals.id],
    }),
    correctedBy: one(principal, {
      fields: [feedbackSignalCorrections.correctedByPrincipalId],
      references: [principal.id],
      relationName: 'signalCorrectionAuthor',
    }),
  })
)

export const externalUserMappingsRelations = relations(externalUserMappings, ({ one }) => ({
  principal: one(principal, {
    fields: [externalUserMappings.principalId],
    references: [principal.id],
    relationName: 'externalUserMapping',
  }),
}))
