/**
 * Reading the passage projection's state (QUINN-PRODUCT P5).
 *
 * Split from `knowledge-index.service.ts` so the writer stays on one screen.
 * Both halves are reads of the same three tables; nothing here builds or
 * activates anything.
 */
import {
  db,
  and,
  eq,
  sql,
  asc,
  isNull,
  inArray,
  assistantDocuments,
  assistantKnowledgeSources,
  assistantSourceVersions,
  assistantWebSources,
  helpCenterArticles,
  type AssistantIndexedSourceType,
} from '@/lib/server/db'
import { fromUuid, toUuid } from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import type { KnowledgeSourceRef } from './knowledge-index.service'

/** The id prefix each indexed source type's rows carry, for reading a uuid back. */
export const SOURCE_ID_PREFIX = {
  article: 'article',
  document: 'assistant_document',
  webpage: 'assistant_web_source',
} as const

export interface KnowledgeSourceHealth {
  sourceType: AssistantIndexedSourceType
  sourceId: string
  status: 'indexed' | 'pending' | 'indexing' | 'failed'
  /** True when a complete generation is serving, whatever the status says. */
  serving: boolean
  generation: number | null
  lastIndexedAt: Date | null
  lastFailureReason: string | null
  degradedReason: string | null
  chunkCount: number | null
}

/**
 * What the Knowledge page shows per row.
 *
 * `serving` is separate from `status` because they answer different questions:
 * a failed refresh over a good generation is still answering, and a source that
 * has never indexed successfully is not, and only the second one is a source
 * the workspace has effectively lost.
 */
export async function listKnowledgeSourceHealth(
  sourceType: AssistantIndexedSourceType,
  sourceIds: readonly string[],
  exec: Executor = db
): Promise<Map<string, KnowledgeSourceHealth>> {
  if (sourceIds.length === 0) return new Map()
  const rows = await exec
    .select({
      sourceId: assistantKnowledgeSources.sourceId,
      status: assistantKnowledgeSources.indexingStatus,
      activeVersionId: assistantKnowledgeSources.activeVersionId,
      lastIndexedAt: assistantKnowledgeSources.lastIndexedAt,
      lastFailureReason: assistantKnowledgeSources.lastFailureReason,
      generation: assistantSourceVersions.generation,
      degradedReason: assistantSourceVersions.degradedReason,
      chunkCount: assistantSourceVersions.chunkCount,
    })
    .from(assistantKnowledgeSources)
    .leftJoin(
      assistantSourceVersions,
      eq(assistantSourceVersions.id, assistantKnowledgeSources.activeVersionId)
    )
    .where(
      and(
        eq(assistantKnowledgeSources.sourceType, sourceType),
        inArray(assistantKnowledgeSources.sourceId, sourceIds.map(toUuid)),
        isNull(assistantKnowledgeSources.tombstonedAt)
      )
    )
  const prefix = SOURCE_ID_PREFIX[sourceType]
  return new Map(
    rows.map((row) => [
      fromUuid(prefix, row.sourceId),
      {
        sourceType,
        sourceId: fromUuid(prefix, row.sourceId),
        status: row.status,
        serving: row.activeVersionId !== null,
        generation: row.generation ?? null,
        lastIndexedAt: row.lastIndexedAt,
        lastFailureReason: row.lastFailureReason,
        degradedReason: row.degradedReason ?? null,
        chunkCount: row.chunkCount ?? null,
      },
    ])
  )
}

/**
 * One bounded page of sources the projection has never seen, oldest first.
 *
 * The backfill's read half, and the reason it needs no cursor: requesting an
 * index writes the projection row before the work runs, so a source drops out
 * of this query the moment it is claimed. A pass that dies half way leaves the
 * rest unclaimed and the next pass resumes exactly there.
 *
 * Sources are enumerated from the tables that own them, because the projection
 * is precisely what does not exist yet for a workspace upgrading into this step.
 */
export async function pageUnindexedSources(limit: number): Promise<KnowledgeSourceRef[]> {
  const refs: KnowledgeSourceRef[] = []

  const articles = await db
    .select({ id: helpCenterArticles.id })
    .from(helpCenterArticles)
    .where(
      and(
        isNull(helpCenterArticles.deletedAt),
        sql`NOT EXISTS (SELECT 1 FROM assistant_knowledge_sources k WHERE k.source_type = 'article' AND k.source_id = ${helpCenterArticles.id})`
      )
    )
    .orderBy(asc(helpCenterArticles.createdAt))
    .limit(limit)
  refs.push(...articles.map((row) => ({ sourceType: 'article' as const, sourceId: row.id })))
  if (refs.length >= limit) return refs

  const documents = await db
    .select({ id: assistantDocuments.id })
    .from(assistantDocuments)
    .where(
      and(
        isNull(assistantDocuments.deletedAt),
        sql`NOT EXISTS (SELECT 1 FROM assistant_knowledge_sources k WHERE k.source_type = 'document' AND k.source_id = ${assistantDocuments.id})`
      )
    )
    .orderBy(asc(assistantDocuments.createdAt))
    .limit(limit - refs.length)
  refs.push(...documents.map((row) => ({ sourceType: 'document' as const, sourceId: row.id })))
  if (refs.length >= limit) return refs

  const pages = await db
    .select({ id: assistantWebSources.id })
    .from(assistantWebSources)
    .where(
      sql`NOT EXISTS (SELECT 1 FROM assistant_knowledge_sources k WHERE k.source_type = 'webpage' AND k.source_id = ${assistantWebSources.id})`
    )
    .orderBy(asc(assistantWebSources.createdAt))
    .limit(limit - refs.length)
  refs.push(...pages.map((row) => ({ sourceType: 'webpage' as const, sourceId: row.id })))
  return refs
}
