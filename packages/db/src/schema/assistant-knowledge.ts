/**
 * The derived passage index (QUINN-PRODUCT P5).
 *
 * These three tables are a SEARCH PROJECTION over sources that already exist.
 * They own nothing: the help-center article, the uploaded document and the
 * crawled web page remain the record, keep their public URLs and keep their own
 * authorization predicates. Nothing here is read without joining back to the
 * source row, which is why a category turning private, an article being
 * unpublished or a document being soft-deleted takes its passages out of
 * retrieval in the same instant, with no reindex and no copied audience tag to
 * go stale.
 *
 * The projection exists for one reason the whole-source adapters cannot fix: a
 * source is embedded from its first 8,000 characters and excerpted from its
 * first 1,200, so a fact further down is invisible to the generator even when
 * the row itself matches. A passage is both the unit that matches and the unit
 * that is supplied.
 *
 * Generations, not mutations. An index run stages a new `assistant_source_versions`
 * row with its own chunks and only then becomes the source's active generation,
 * in one statement. A refresh that fails half way therefore leaves the previous
 * complete generation serving traffic, and the failure is a row an operator can
 * read rather than a gap in the corpus. The embedding model and dimensions are
 * recorded per generation because equal dimensions do not imply a compatible
 * space: a model change produces a new generation and the vector arm ignores
 * any generation that was embedded by a different model.
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  customType,
  check,
  foreignKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { typeIdWithDefault, typeIdColumn, typeIdColumnNullable } from '@quackback/ids/drizzle'

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector'
  },
})

const vector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(1536)'
  },
})

/**
 * Which source kinds the projection indexes today.
 *
 * Deliberately the three long-form kinds. Snippets, posts, changelog entries,
 * ticket summaries and conversation summaries are short or operational and keep
 * their existing whole-source adapters until evaluation justifies moving them.
 */
export const ASSISTANT_INDEXED_SOURCE_TYPES = ['article', 'document', 'webpage'] as const
export type AssistantIndexedSourceType = (typeof ASSISTANT_INDEXED_SOURCE_TYPES)[number]

/**
 * What the projection can say about a source.
 *
 * `failed` with an active generation is a failed refresh: the last complete
 * generation still answers. `failed` with no active generation is a first-ever
 * failure and the source is simply unavailable to retrieval, which is what the
 * Knowledge page labels.
 */
export const ASSISTANT_INDEX_STATUSES = ['pending', 'indexing', 'indexed', 'failed'] as const
export type AssistantIndexStatus = (typeof ASSISTANT_INDEX_STATUSES)[number]

/** A generation's lifecycle. Only `active` is ever read by retrieval. */
export const ASSISTANT_SOURCE_VERSION_STATUSES = [
  'staging',
  'active',
  'superseded',
  'failed',
] as const
export type AssistantSourceVersionStatus = (typeof ASSISTANT_SOURCE_VERSION_STATUSES)[number]

export const assistantKnowledgeSources = pgTable(
  'assistant_knowledge_sources',
  {
    id: typeIdWithDefault('assistant_knowledge_source')('id').primaryKey(),
    /** Canonical citation source type, so a passage maps back to the citation contract. */
    sourceType: text('source_type', { enum: ASSISTANT_INDEXED_SOURCE_TYPES }).notNull(),
    /** The source row's own id, as text: three different id spaces share this column. */
    sourceId: text('source_id').notNull(),
    /**
     * The generation retrieval reads. Deliberately NOT a declared foreign key:
     * the two tables reference each other, and an inline circular constraint
     * cannot be expressed in a replay-safe migration that creates them in
     * order. Activation sets it inside the same transaction that flips the
     * version row, so the pair cannot disagree.
     */
    activeVersionId: typeIdColumnNullable('assistant_source_version')('active_version_id'),
    /** Durable revision of the source content the last index request observed. */
    sourceRevision: text('source_revision'),
    indexingStatus: text('indexing_status', { enum: ASSISTANT_INDEX_STATUSES })
      .notNull()
      .default('pending'),
    /** Monotonic generation counter, so a retried run never reuses a number. */
    generationCounter: integer('generation_counter').notNull().default(0),
    /** Bounded reason for the most recent failure, for the Knowledge page. */
    lastFailureReason: text('last_failure_reason'),
    /** When a complete generation last became active. Not an external effect. */
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
    /** Set when the source is deleted; the row is kept so history stays explainable. */
    tombstonedAt: timestamp('tombstoned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'assistant_knowledge_sources_type_check',
      sql`${t.sourceType} IN ('article', 'document', 'webpage')`
    ),
    check(
      'assistant_knowledge_sources_status_check',
      sql`${t.indexingStatus} IN ('pending', 'indexing', 'indexed', 'failed')`
    ),
    uniqueIndex('assistant_knowledge_sources_identity_uidx').on(t.sourceType, t.sourceId),
    index('assistant_knowledge_sources_status_idx').on(t.indexingStatus, t.updatedAt),
  ]
)

export type AssistantKnowledgeSource = typeof assistantKnowledgeSources.$inferSelect

export const assistantSourceVersions = pgTable(
  'assistant_source_versions',
  {
    id: typeIdWithDefault('assistant_source_version')('id').primaryKey(),
    knowledgeSourceId: typeIdColumn('assistant_knowledge_source')('knowledge_source_id').notNull(),
    generation: integer('generation').notNull(),
    /** Hash of the normalized extracted text this generation was built from. */
    contentHash: text('content_hash').notNull(),
    parserVersion: text('parser_version').notNull(),
    chunkerVersion: text('chunker_version').notNull(),
    /** Null means the generation carries no vectors at all (lexical only). */
    embeddingModel: text('embedding_model'),
    embeddingDimensions: integer('embedding_dimensions'),
    status: text('status', { enum: ASSISTANT_SOURCE_VERSION_STATUSES })
      .notNull()
      .default('staging'),
    /** Why this generation is lexical-only, when it is. Recorded, never inferred. */
    degradedReason: text('degraded_reason'),
    chunkCount: integer('chunk_count').notNull().default(0),
    embeddedChunkCount: integer('embedded_chunk_count').notNull().default(0),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'assistant_source_versions_status_check',
      sql`${t.status} IN ('staging', 'active', 'superseded', 'failed')`
    ),
    foreignKey({
      name: 'assistant_source_versions_source_fk',
      columns: [t.knowledgeSourceId],
      foreignColumns: [assistantKnowledgeSources.id],
    }).onDelete('cascade'),
    uniqueIndex('assistant_source_versions_generation_uidx').on(t.knowledgeSourceId, t.generation),
    index('assistant_source_versions_status_idx').on(t.knowledgeSourceId, t.status),
  ]
)

export type AssistantSourceVersion = typeof assistantSourceVersions.$inferSelect

export const assistantChunks = pgTable(
  'assistant_chunks',
  {
    id: typeIdWithDefault('assistant_chunk')('id').primaryKey(),
    versionId: typeIdColumn('assistant_source_version')('version_id').notNull(),
    /** Denormalized for the retrieval join only; the version is the owner. */
    knowledgeSourceId: typeIdColumn('assistant_knowledge_source')('knowledge_source_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    /** "Billing > Refunds > Annual plans", so a passage can be placed in its source. */
    headingPath: text('heading_path'),
    /** Character offsets into the normalized source text this passage came from. */
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    content: text('content').notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(heading_path, '')), 'A') || setweight(to_tsvector('english', content), 'B')`
    ),
    embedding: vector('embedding'),
    /** Which space this vector lives in. Compared before the vector arm runs. */
    embeddingModel: text('embedding_model'),
    chunkHash: text('chunk_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'assistant_chunks_version_fk',
      columns: [t.versionId],
      foreignColumns: [assistantSourceVersions.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'assistant_chunks_source_fk',
      columns: [t.knowledgeSourceId],
      foreignColumns: [assistantKnowledgeSources.id],
    }).onDelete('cascade'),
    uniqueIndex('assistant_chunks_ordinal_uidx').on(t.versionId, t.ordinal),
    index('assistant_chunks_search_vector_idx').using('gin', t.searchVector),
    index('assistant_chunks_embedding_hnsw_idx')
      .using('hnsw', sql`${t.embedding} vector_cosine_ops`)
      .where(sql`${t.embedding} IS NOT NULL`),
    check('assistant_chunks_offsets_check', sql`${t.charEnd} >= ${t.charStart}`),
  ]
)

export type AssistantChunk = typeof assistantChunks.$inferSelect

export const assistantSourceVersionsRelations = relations(assistantSourceVersions, ({ one }) => ({
  knowledgeSource: one(assistantKnowledgeSources, {
    fields: [assistantSourceVersions.knowledgeSourceId],
    references: [assistantKnowledgeSources.id],
  }),
}))

export const assistantChunksRelations = relations(assistantChunks, ({ one }) => ({
  version: one(assistantSourceVersions, {
    fields: [assistantChunks.versionId],
    references: [assistantSourceVersions.id],
  }),
}))
