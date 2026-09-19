/**
 * Building and activating a source's passage generation (QUINN-PRODUCT P5).
 *
 * The projection's only writer. It reads a source from the table that owns it,
 * normalizes and chunks the text, embeds each passage, and only then makes the
 * result the source's active generation. Reading is somebody else's job:
 * nothing here applies a visibility predicate, because the index is not allowed
 * to decide who may see a source. Retrieval joins back to the source row for
 * that, every time.
 *
 * Three rules this file exists to keep:
 *
 * - **Stage, then activate.** Chunks are written against a `staging` version
 *   nothing reads. Activation is one transaction that supersedes the old
 *   generation, flips the new one and points the source at it. A crash before
 *   that leaves a staging row and the previous generation still serving.
 * - **A partial generation never publishes.** If embeddings are configured and
 *   any passage fails to embed, the generation is marked `failed` with a reason
 *   and the previous complete generation stays active. A first-ever failure
 *   leaves the source with no active generation, which is exactly the
 *   "unavailable" the Knowledge page labels.
 * - **Never mix embedding spaces.** The model is recorded on the generation and
 *   on every passage. A model change produces a new generation; retrieval's
 *   vector arm compares the recorded model against the live one and simply does
 *   not run over a generation from another space.
 *
 * Object storage is not required anywhere in this path. Documents already store
 * their extracted text as the grounding source of truth, and that text is what
 * is chunked.
 */
import {
  db,
  and,
  eq,
  ne,
  sql,
  isNull,
  desc,
  inArray,
  assistantChunks,
  assistantDocuments,
  assistantKnowledgeSources,
  assistantSourceVersions,
  assistantWebSources,
  helpCenterArticles,
  type AssistantIndexedSourceType,
  type AssistantKnowledgeSource,
} from '@/lib/server/db'
import { createHash } from 'node:crypto'
import { toUuid } from '@quackback/ids'
import type {
  AssistantDocumentId,
  AssistantKnowledgeSourceId,
  AssistantSourceVersionId,
  AssistantWebSourceId,
  KbArticleId,
} from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { enqueueJob } from '@/lib/server/jobs/job-queue'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { logger } from '@/lib/server/logger'
import { CHUNKER_VERSION, chunkEmbeddingInput, chunkSource } from './chunking'

const log = logger.child({ component: 'assistant-knowledge-index' })

/**
 * The ingestion queue's name, declared here rather than in the handler module
 * so a source write can ask for an index without importing the handler (which
 * would import this module back).
 */
export const ASSISTANT_KNOWLEDGE_INDEX_QUEUE = 'assistant-knowledge-index'

/** Bumped when normalization changes what a generation is built from. */
export const INDEX_PARSER_VERSION = 'v1'

/** The dimension every embedding column in this schema is declared at. */
export const INDEX_EMBEDDING_DIMENSIONS = 1536

/**
 * A ceiling on one source's passages, so a pathological upload cannot turn one
 * index run into thousands of provider calls. Text past it is not indexed and
 * the generation records why.
 */
export const MAX_CHUNKS_PER_SOURCE = 400

/** How many passages are embedded at once. Bounded so ingestion cannot saturate the provider. */
const EMBED_BATCH = 4

/** How many complete generations are kept behind the active one. */
const KEEP_SUPERSEDED_GENERATIONS = 1

export interface KnowledgeSourceRef {
  sourceType: AssistantIndexedSourceType
  sourceId: string
}

export type IndexOutcome =
  /** A new generation is active. */
  | {
      kind: 'indexed'
      versionId: AssistantSourceVersionId
      chunks: number
      degraded: string | null
    }
  /** The content and the embedding space are what the active generation already holds. */
  | { kind: 'unchanged' }
  /** The source is gone. Its passages are excluded by the retrieval join either way. */
  | { kind: 'tombstoned' }
  /** The refresh failed. `retained` says whether a previous generation still answers. */
  | { kind: 'failed'; reason: string; retained: boolean }

interface LoadedSource {
  title: string
  text: string
  updatedAt: Date | null
}

/** Normalize line endings and trim, so a cosmetic rewrite does not mint a generation. */
function normalizeSourceText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Read a source from the table that owns it. Null means the row is gone or
 * soft-deleted; visibility is deliberately NOT consulted here.
 */
async function loadSource(ref: KnowledgeSourceRef, exec: Executor): Promise<LoadedSource | null> {
  switch (ref.sourceType) {
    case 'article': {
      const [row] = await exec
        .select({
          title: helpCenterArticles.title,
          content: helpCenterArticles.content,
          updatedAt: helpCenterArticles.updatedAt,
        })
        .from(helpCenterArticles)
        .where(
          and(
            eq(helpCenterArticles.id, ref.sourceId as KbArticleId),
            isNull(helpCenterArticles.deletedAt)
          )
        )
        .limit(1)
      return row ? { title: row.title, text: row.content, updatedAt: row.updatedAt } : null
    }
    case 'document': {
      const [row] = await exec
        .select({
          title: assistantDocuments.title,
          content: assistantDocuments.content,
          updatedAt: assistantDocuments.updatedAt,
        })
        .from(assistantDocuments)
        .where(
          and(
            eq(assistantDocuments.id, ref.sourceId as AssistantDocumentId),
            isNull(assistantDocuments.deletedAt)
          )
        )
        .limit(1)
      return row ? { title: row.title, text: row.content, updatedAt: row.updatedAt } : null
    }
    case 'webpage': {
      const [row] = await exec
        .select({
          title: assistantWebSources.title,
          content: assistantWebSources.content,
          updatedAt: assistantWebSources.updatedAt,
        })
        .from(assistantWebSources)
        .where(eq(assistantWebSources.id, ref.sourceId as AssistantWebSourceId))
        .limit(1)
      return row ? { title: row.title, text: row.content, updatedAt: row.updatedAt } : null
    }
    default: {
      const exhaustive: never = ref.sourceType
      throw new Error(`loadSource: unhandled source type "${String(exhaustive)}"`)
    }
  }
}

/**
 * The projection row for a source, created on first sight.
 *
 * `ON CONFLICT DO UPDATE` on the identity index, so two writers requesting an
 * index for the same source at the same moment agree without a lock.
 */
export async function ensureKnowledgeSourceRow(
  ref: KnowledgeSourceRef,
  revision: string | null,
  exec: Executor = db
): Promise<AssistantKnowledgeSource> {
  const [row] = await exec
    .insert(assistantKnowledgeSources)
    .values({
      sourceType: ref.sourceType,
      sourceId: toUuid(ref.sourceId),
      sourceRevision: revision,
      indexingStatus: 'pending',
    })
    .onConflictDoUpdate({
      target: [assistantKnowledgeSources.sourceType, assistantKnowledgeSources.sourceId],
      set: {
        sourceRevision: revision ?? sql`${assistantKnowledgeSources.sourceRevision}`,
        tombstonedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning()
  return row
}

/**
 * Ask for a source to be indexed, carrying the revision the caller observed.
 *
 * Deliberately best effort at the call site: a help-center save or a document
 * upload must not fail because the index queue is unavailable, and the backfill
 * pass collects anything a lost request left behind.
 */
export async function requestKnowledgeIndexing(
  ref: KnowledgeSourceRef,
  opts: { revision?: string | null; exec?: Executor } = {}
): Promise<void> {
  const exec = opts.exec ?? db
  await ensureKnowledgeSourceRow(ref, opts.revision ?? null, exec)
  await enqueueJob({
    queue: ASSISTANT_KNOWLEDGE_INDEX_QUEUE,
    payload: { kind: 'source', sourceType: ref.sourceType, sourceId: ref.sourceId },
    dedupeKey: `assistant-knowledge-index:${ref.sourceType}:${ref.sourceId}`,
    maxAttempts: 3,
    executor: exec,
  })
}

/** Fire-and-forget request for a call site that must not fail on the index. */
export function requestKnowledgeIndexingSoon(
  ref: KnowledgeSourceRef,
  opts: { revision?: string | null } = {}
): void {
  void requestKnowledgeIndexing(ref, opts).catch((err) =>
    log.warn(
      { err, source_type: ref.sourceType, source_id: ref.sourceId },
      'could not request knowledge indexing'
    )
  )
}

/**
 * Mark a source gone.
 *
 * The chunks are not deleted here and do not need to be: retrieval joins to the
 * source row, which is already deleted or soft-deleted, so the passages are
 * unreachable from the moment the source changed and not from the moment this
 * runs. The tombstone is what stops the backfill re-indexing it and what the
 * Knowledge page reads.
 */
export async function tombstoneKnowledgeSource(
  ref: KnowledgeSourceRef,
  exec: Executor = db
): Promise<void> {
  await exec
    .update(assistantKnowledgeSources)
    .set({ tombstonedAt: new Date(), activeVersionId: null, updatedAt: new Date() })
    .where(
      and(
        eq(assistantKnowledgeSources.sourceType, ref.sourceType),
        eq(assistantKnowledgeSources.sourceId, toUuid(ref.sourceId))
      )
    )
}

/** Fire-and-forget tombstone for a delete path that must not fail on the index. */
export function tombstoneKnowledgeSourceSoon(ref: KnowledgeSourceRef): void {
  void tombstoneKnowledgeSource(ref).catch((err) =>
    log.warn(
      { err, source_type: ref.sourceType, source_id: ref.sourceId },
      'could not tombstone a knowledge source'
    )
  )
}

/**
 * Build and activate one source's generation.
 *
 * Returns rather than throws for every outcome an operator would want recorded,
 * so the queue handler can log one line and finish instead of burning attempts
 * on a source whose text simply cannot be indexed.
 */
export async function indexKnowledgeSource(ref: KnowledgeSourceRef): Promise<IndexOutcome> {
  const source = await loadSource(ref, db)
  if (!source) {
    await tombstoneKnowledgeSource(ref)
    return { kind: 'tombstoned' }
  }

  const row = await ensureKnowledgeSourceRow(ref, null)
  const text = normalizeSourceText(source.text)
  const model = getEmbeddingModel()
  const contentHash = sha256(`${INDEX_PARSER_VERSION}\u0000${CHUNKER_VERSION}\u0000${text}`)

  const active = row.activeVersionId ? await loadVersion(row.activeVersionId) : null
  // Same text AND the same embedding space: there is nothing a new generation
  // would say differently. A model change falls through on purpose, because the
  // vectors, not the passages, are what moved.
  if (
    active &&
    active.status === 'active' &&
    active.contentHash === contentHash &&
    (active.embeddingModel ?? null) === (model ?? null)
  ) {
    return { kind: 'unchanged' }
  }

  const chunks = chunkSource(text)
  if (chunks.length === 0) {
    return await failGeneration(row, null, 'no_indexable_text', active !== null)
  }
  const truncated = chunks.length > MAX_CHUNKS_PER_SOURCE
  const kept = truncated ? chunks.slice(0, MAX_CHUNKS_PER_SOURCE) : chunks

  await db
    .update(assistantKnowledgeSources)
    .set({ indexingStatus: 'indexing', updatedAt: new Date() })
    .where(eq(assistantKnowledgeSources.id, row.id))

  const generation = row.generationCounter + 1
  const [version] = await db
    .insert(assistantSourceVersions)
    .values({
      knowledgeSourceId: row.id,
      generation,
      contentHash,
      parserVersion: INDEX_PARSER_VERSION,
      chunkerVersion: CHUNKER_VERSION,
      embeddingModel: model,
      embeddingDimensions: model ? INDEX_EMBEDDING_DIMENSIONS : null,
      status: 'staging',
      chunkCount: kept.length,
      sourceUpdatedAt: source.updatedAt,
      degradedReason: truncated ? 'source_truncated_at_chunk_ceiling' : null,
    })
    .returning()
  await db
    .update(assistantKnowledgeSources)
    .set({ generationCounter: generation, updatedAt: new Date() })
    .where(eq(assistantKnowledgeSources.id, row.id))

  // Embeddings are optional infrastructure: a workspace with no embedding model
  // still gets passage retrieval, lexically, and the generation says so rather
  // than pretending it has vectors.
  let embedded = 0
  let degraded: string | null = truncated ? 'source_truncated_at_chunk_ceiling' : null
  const vectors = new Map<number, number[]>()
  if (!model) {
    degraded = 'embeddings_unavailable'
  } else {
    for (let offset = 0; offset < kept.length; offset += EMBED_BATCH) {
      const batch = kept.slice(offset, offset + EMBED_BATCH)
      const results = await Promise.all(
        batch.map((chunk) =>
          generateEmbedding(chunkEmbeddingInput(chunk), {
            pipelineStep: 'assistant_knowledge_chunk_embedding',
          })
        )
      )
      for (let i = 0; i < results.length; i++) {
        const vector = results[i]
        // A configured model returning nothing is a failure, not an absence.
        // Publishing the half of the corpus that embedded would leave the rest
        // permanently unreachable by the vector arm with nothing recording why.
        if (!vector) {
          return await failGeneration(
            row,
            version.id,
            'embedding_incomplete',
            active !== null && active.status === 'active'
          )
        }
        vectors.set(batch[i].ordinal, vector)
        embedded++
      }
    }
  }

  await db.insert(assistantChunks).values(
    kept.map((chunk) => {
      const vector = vectors.get(chunk.ordinal)
      return {
        versionId: version.id,
        knowledgeSourceId: row.id,
        ordinal: chunk.ordinal,
        headingPath: chunk.headingPath,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        content: chunk.content,
        ...(vector
          ? { embedding: sql<number[]>`${`[${vector.join(',')}]`}::vector`, embeddingModel: model }
          : {}),
        chunkHash: sha256(chunk.content),
      }
    })
  )

  await activateGeneration(row.id, version.id, embedded, degraded)
  await pruneSupersededGenerations(row.id)

  log.info(
    {
      source_type: ref.sourceType,
      source_id: ref.sourceId,
      generation,
      chunks: kept.length,
      embedded,
      degraded,
    },
    'knowledge source generation activated'
  )
  return { kind: 'indexed', versionId: version.id, chunks: kept.length, degraded }
}

async function loadVersion(id: AssistantSourceVersionId) {
  const [row] = await db
    .select()
    .from(assistantSourceVersions)
    .where(eq(assistantSourceVersions.id, id))
    .limit(1)
  return row ?? null
}

/**
 * The atomic swap: the old generation is superseded, the new one becomes
 * active and the source points at it, in one transaction. Nothing reads a
 * staging version, so until this commits the previous generation is what
 * retrieval sees.
 */
async function activateGeneration(
  sourceId: AssistantKnowledgeSourceId,
  versionId: AssistantSourceVersionId,
  embedded: number,
  degraded: string | null
): Promise<void> {
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(assistantSourceVersions)
      .set({ status: 'superseded', completedAt: now })
      .where(
        and(
          eq(assistantSourceVersions.knowledgeSourceId, sourceId),
          eq(assistantSourceVersions.status, 'active'),
          ne(assistantSourceVersions.id, versionId)
        )
      )
    await tx
      .update(assistantSourceVersions)
      .set({
        status: 'active',
        completedAt: now,
        embeddedChunkCount: embedded,
        degradedReason: degraded,
      })
      .where(eq(assistantSourceVersions.id, versionId))
    await tx
      .update(assistantKnowledgeSources)
      .set({
        activeVersionId: versionId,
        indexingStatus: 'indexed',
        lastIndexedAt: now,
        lastFailureReason: null,
        updatedAt: now,
      })
      .where(eq(assistantKnowledgeSources.id, sourceId))
  })
}

/**
 * Record a refresh failure without touching what is serving.
 *
 * `retained` is the whole point of the return value: a workspace needs to know
 * whether it is running on a stale-but-complete generation or has no index for
 * this source at all.
 */
async function failGeneration(
  row: AssistantKnowledgeSource,
  versionId: AssistantSourceVersionId | null,
  reason: string,
  retained: boolean
): Promise<IndexOutcome> {
  const now = new Date()
  await db.transaction(async (tx) => {
    if (versionId) {
      await tx
        .update(assistantSourceVersions)
        .set({ status: 'failed', failureReason: reason, completedAt: now })
        .where(eq(assistantSourceVersions.id, versionId))
      // A failed generation's passages are dead weight and must never be
      // mistaken for the corpus; the active generation keeps its own.
      await tx.delete(assistantChunks).where(eq(assistantChunks.versionId, versionId))
    }
    await tx
      .update(assistantKnowledgeSources)
      .set({ indexingStatus: 'failed', lastFailureReason: reason, updatedAt: now })
      .where(eq(assistantKnowledgeSources.id, row.id))
  })
  log.warn(
    { source_type: row.sourceType, source_id: row.sourceId, reason, retained },
    'knowledge source refresh failed'
  )
  return { kind: 'failed', reason, retained }
}

/** Keep the active generation and one behind it; older passages are storage with no reader. */
async function pruneSupersededGenerations(sourceId: AssistantKnowledgeSourceId): Promise<void> {
  const superseded = await db
    .select({ id: assistantSourceVersions.id })
    .from(assistantSourceVersions)
    .where(
      and(
        eq(assistantSourceVersions.knowledgeSourceId, sourceId),
        inArray(assistantSourceVersions.status, ['superseded', 'failed'])
      )
    )
    .orderBy(desc(assistantSourceVersions.generation))
  const stale = superseded.slice(KEEP_SUPERSEDED_GENERATIONS).map((row) => row.id)
  if (stale.length === 0) return
  await db.delete(assistantSourceVersions).where(inArray(assistantSourceVersions.id, stale))
}
