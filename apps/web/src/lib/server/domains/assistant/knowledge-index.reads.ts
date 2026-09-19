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
 * Help-center articles, summarized rather than listed (QUINN-PRODUCT P8).
 *
 * Articles are indexed and served from passages exactly as documents and web
 * pages are, but the Knowledge page does not list them: they live on their own
 * screens and there can be hundreds. So this answers the question that page can
 * actually act on — is anything wrong, and which ones — and stays silent when
 * nothing is.
 *
 * `total` counts the articles a workspace has, not the projection rows, so an
 * article the projection has never seen is visible as one that is not indexed
 * rather than absent from both numbers. The unhealthy list is bounded and
 * carries titles, because an id is not something anybody can act on.
 */
export interface ArticleIndexHealthSummary {
  /** Articles that exist, deleted ones excluded. */
  total: number
  /** Articles with a complete generation serving right now. */
  serving: number
  /** Articles the projection has never successfully indexed. */
  notIndexed: number
  /** Articles whose last refresh failed while an older generation keeps serving. */
  staleAfterFailure: number
  /** Articles indexed without vectors, so only keyword search reaches them. */
  keywordOnly: number
  /** The ones a person can do something about, newest first. */
  unhealthy: Array<{
    id: string
    title: string
    status: KnowledgeSourceHealth['status']
    serving: boolean
    degraded: string | null
  }>
}

export async function getArticleIndexHealthSummary(
  unhealthyLimit = 10,
  exec: Executor = db
): Promise<ArticleIndexHealthSummary> {
  const rows = await exec
    .select({
      id: helpCenterArticles.id,
      title: helpCenterArticles.title,
      status: assistantKnowledgeSources.indexingStatus,
      activeVersionId: assistantKnowledgeSources.activeVersionId,
      degradedReason: assistantSourceVersions.degradedReason,
    })
    .from(helpCenterArticles)
    .leftJoin(
      assistantKnowledgeSources,
      and(
        eq(assistantKnowledgeSources.sourceType, 'article'),
        eq(assistantKnowledgeSources.sourceId, helpCenterArticles.id),
        isNull(assistantKnowledgeSources.tombstonedAt)
      )
    )
    .leftJoin(
      assistantSourceVersions,
      eq(assistantSourceVersions.id, assistantKnowledgeSources.activeVersionId)
    )
    .where(isNull(helpCenterArticles.deletedAt))

  const summary: ArticleIndexHealthSummary = {
    total: rows.length,
    serving: 0,
    notIndexed: 0,
    staleAfterFailure: 0,
    keywordOnly: 0,
    unhealthy: [],
  }
  for (const row of rows) {
    const serving = row.activeVersionId !== null
    const status = row.status ?? 'pending'
    const degraded = row.degradedReason ?? null
    if (serving) summary.serving += 1
    if (status === 'failed' && serving) summary.staleAfterFailure += 1
    else if (!serving) summary.notIndexed += 1
    if (serving && degraded === 'embeddings_unavailable') summary.keywordOnly += 1

    const healthy = serving && status === 'indexed' && degraded === null
    if (!healthy && summary.unhealthy.length < unhealthyLimit) {
      summary.unhealthy.push({ id: row.id, title: row.title, status, serving, degraded })
    }
  }
  return summary
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
