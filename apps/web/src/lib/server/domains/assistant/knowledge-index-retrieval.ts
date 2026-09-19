/**
 * Retrieving passages from the derived index (QUINN-PRODUCT P6).
 *
 * One query per indexed source type, each of which joins the passage back to the
 * row that owns it and applies that row's OWN visibility predicate and use
 * switch. Nothing here reads an audience tag copied into the index, because
 * there is none: a category turning private, an article being unpublished, a
 * document being soft-deleted or a use switch being turned off changes the join,
 * not a stale column, so the passages disappear from the very next query rather
 * than from the next reindex.
 *
 * Two arms, run independently and merged by rank, exactly as the outer composer
 * merges sources:
 *
 * - **Lexical.** `search_vector @@ websearch_to_tsquery`, ranked by `ts_rank`.
 *   The heading path is weighted above the body, so a passage under "Refunds"
 *   outranks one that merely mentions the word.
 * - **Vector.** Cosine similarity, and only over a generation whose recorded
 *   embedding model is the live one. Equal dimensions do not imply a compatible
 *   space, so a generation embedded by another model contributes nothing here
 *   until it is rebuilt rather than being silently compared.
 *
 * Merging by rank rather than by raw score is the same reasoning the source
 * composer documents: `ts_rank` and cosine similarity are different scales, and
 * a raw sort lets whichever is larger crowd the other out entirely.
 */
import {
  db,
  and,
  eq,
  inArray,
  isNull,
  sql,
  assistantChunks,
  assistantDocuments,
  assistantKnowledgeSources,
  assistantSourceVersions,
  assistantWebSources,
  helpCenterArticles,
  helpCenterCategories,
  type AssistantIndexedSourceType,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import { fromUuid, toUuid } from '@quackback/ids'
import { ANONYMOUS_ACTOR, type Actor } from '@/lib/server/policy/types'
import {
  helpCenterVisibilityConditions,
  orTermsTsQuery,
} from '@/lib/server/domains/help-center/help-center-search.service'
import { hcArticlePath } from '@/lib/shared/help-center-url'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import type { ContentAudience } from './audience'
import { toHelpCenterAudience } from './audience'
import { sourceUseFilter } from './source-use'
import { toVectorLiteral, type QueryEmbedding } from './retrieval-embedding'
import { SOURCE_ID_PREFIX } from './knowledge-index.reads'

/**
 * A passage is short and self-contained, so a lexical hit on one means far more
 * than the same hit somewhere inside a whole article. The floor is
 * correspondingly low: it exists to drop a passage that shares one incidental
 * term with the question, not to demand a dense match.
 */
export const PASSAGE_KEYWORD_RANK_FLOOR = 0.02

/** Cosine floor for the vector arm, the same bar the whole-source adapters use. */
export const PASSAGE_SEMANTIC_SIMILARITY_FLOOR = 0.35

/** How many passages each arm considers before the merge trims to the budget. */
const ARM_CANDIDATE_MULTIPLIER = 4

export interface RetrievedPassage {
  sourceType: AssistantIndexedSourceType
  /** The source's own id, in its own id space. */
  sourceId: string
  chunkId: string
  /** `<generation>:<content hash prefix>`, so a later edit to the source is detectable. */
  sourceVersion: string
  headingPath: string | null
  passage: string
  score: number
  arm: 'lexical' | 'vector'
  title: string
  url: string
  updatedAt: Date
  /** False when the row is above the public ceiling or excluded from customer use. */
  publicToCustomers: boolean
}

/** What every source type's query returns, before the citation shape is applied. */
interface PassageRow {
  sourceId: string
  chunkId: string
  generation: number
  contentHash: string
  headingPath: string | null
  content: string
  score: number
  title: string
  url: string
  updatedAt: Date
  publicToCustomers: boolean
}

export interface PassageQueryOptions {
  query: string
  ceiling: ContentAudience
  topK: number
  embedding: QueryEmbedding | null
  viewer?: Actor
}

/** Only an active generation, still pointed at by a source nobody has tombstoned. */
function activeGenerationConditions(sourceType: AssistantIndexedSourceType): SQL[] {
  return [
    eq(assistantKnowledgeSources.sourceType, sourceType),
    isNull(assistantKnowledgeSources.tombstonedAt),
    eq(assistantSourceVersions.status, 'active'),
    sql`${assistantKnowledgeSources.activeVersionId} = ${assistantSourceVersions.id}`,
  ]
}

function lexicalMatch(tsQuery: SQL): SQL {
  return sql`(${assistantChunks.searchVector} @@ ${tsQuery} AND ts_rank(${assistantChunks.searchVector}, ${tsQuery}) > ${PASSAGE_KEYWORD_RANK_FLOOR})`
}

/**
 * The vector arm's own guard, and the reason two embedding generations never
 * mix: a passage competes on similarity only when the generation that produced
 * it was embedded by the model asking the question.
 */
function vectorMatch(embedding: QueryEmbedding): SQL {
  const literal = toVectorLiteral(embedding.vector)
  return sql`(${assistantChunks.embedding} IS NOT NULL
    AND ${assistantSourceVersions.embeddingModel} = ${embedding.model}
    AND (1 - (${assistantChunks.embedding} <=> ${literal}::vector)) > ${PASSAGE_SEMANTIC_SIMILARITY_FLOOR})`
}

type ArmQuery = (score: SQL<number>, match: SQL) => Promise<PassageRow[]>

/** Run both arms and merge them by rank. The one place an arm's result is combined. */
async function bothArms(
  sourceType: AssistantIndexedSourceType,
  opts: PassageQueryOptions,
  run: ArmQuery
): Promise<RetrievedPassage[]> {
  const tsQuery = orTermsTsQuery(opts.query)
  const lexical = await run(
    sql<number>`ts_rank(${assistantChunks.searchVector}, ${tsQuery})`,
    lexicalMatch(tsQuery)
  )
  const vector = opts.embedding
    ? await run(
        sql<number>`(1 - (${assistantChunks.embedding} <=> ${toVectorLiteral(opts.embedding.vector)}::vector))`,
        vectorMatch(opts.embedding)
      )
    : []
  return mergePassagesByRank(
    [
      lexical.map((row) => mapPassage(sourceType, row, 'lexical')),
      vector.map((row) => mapPassage(sourceType, row, 'vector')),
    ],
    opts.topK
  )
}

/**
 * Passages from indexed help-center articles.
 *
 * The article's own visibility predicate and use switch are applied here, so
 * this can never widen what the whole-article adapter would have shown;
 * `publicToCustomers` mirrors the same per-row public test that adapter
 * computes, for the copilot leak gate.
 */
function articlePassages(opts: PassageQueryOptions): Promise<RetrievedPassage[]> {
  const audience = toHelpCenterAudience(opts.ceiling)
  const viewer = opts.viewer ?? ANONYMOUS_ACTOR
  const publicRow = sql<boolean>`(${helpCenterCategories.isPublic} AND jsonb_array_length(${helpCenterCategories.segmentIds}) = 0 AND jsonb_array_length(${helpCenterArticles.segmentIds}) = 0 AND ${helpCenterArticles.assistantCustomerUse} AND ${helpCenterArticles.publishedAt} IS NOT NULL AND ${helpCenterArticles.publishedAt} <= now())`

  return bothArms('article', opts, async (score, match) => {
    const rows = await db
      .select({
        sourceId: assistantKnowledgeSources.sourceId,
        chunkId: assistantChunks.id,
        generation: assistantSourceVersions.generation,
        contentHash: assistantSourceVersions.contentHash,
        headingPath: assistantChunks.headingPath,
        content: assistantChunks.content,
        score: score.as('score'),
        title: helpCenterArticles.title,
        urlId: helpCenterArticles.urlId,
        slug: helpCenterArticles.slug,
        updatedAt: helpCenterArticles.updatedAt,
        publicToCustomers: publicRow.as('public_row'),
      })
      .from(assistantChunks)
      .innerJoin(assistantSourceVersions, eq(assistantSourceVersions.id, assistantChunks.versionId))
      .innerJoin(
        assistantKnowledgeSources,
        eq(assistantKnowledgeSources.id, assistantChunks.knowledgeSourceId)
      )
      .innerJoin(
        helpCenterArticles,
        sql`${helpCenterArticles.id} = ${assistantKnowledgeSources.sourceId}`
      )
      .innerJoin(helpCenterCategories, eq(helpCenterArticles.categoryId, helpCenterCategories.id))
      .where(
        and(
          ...activeGenerationConditions('article'),
          isNull(helpCenterArticles.deletedAt),
          ...helpCenterVisibilityConditions(audience, viewer),
          sourceUseFilter(helpCenterArticles, opts.ceiling),
          match
        )
      )
      .orderBy(sql`score DESC`)
      .limit(opts.topK * ARM_CANDIDATE_MULTIPLIER)
    return rows.map((row) => ({
      ...row,
      url: hcArticlePath({ locale: DEFAULT_LOCALE, urlId: row.urlId, slug: row.slug }),
    }))
  })
}

/** Passages from indexed uploaded documents. */
function documentPassages(opts: PassageQueryOptions): Promise<RetrievedPassage[]> {
  return bothArms('document', opts, (score, match) =>
    db
      .select({
        sourceId: assistantKnowledgeSources.sourceId,
        chunkId: assistantChunks.id,
        generation: assistantSourceVersions.generation,
        contentHash: assistantSourceVersions.contentHash,
        headingPath: assistantChunks.headingPath,
        content: assistantChunks.content,
        score: score.as('score'),
        title: assistantDocuments.title,
        // No public page exists for an uploaded document; the citation carries
        // its title with an empty URL, exactly as the whole-document adapter does.
        url: sql<string>`''`,
        updatedAt: assistantDocuments.updatedAt,
        publicToCustomers: assistantDocuments.assistantCustomerUse,
      })
      .from(assistantChunks)
      .innerJoin(assistantSourceVersions, eq(assistantSourceVersions.id, assistantChunks.versionId))
      .innerJoin(
        assistantKnowledgeSources,
        eq(assistantKnowledgeSources.id, assistantChunks.knowledgeSourceId)
      )
      .innerJoin(
        assistantDocuments,
        sql`${assistantDocuments.id} = ${assistantKnowledgeSources.sourceId}`
      )
      .where(
        and(
          ...activeGenerationConditions('document'),
          isNull(assistantDocuments.deletedAt),
          sourceUseFilter(assistantDocuments, opts.ceiling),
          match
        )
      )
      .orderBy(sql`score DESC`)
      .limit(opts.topK * ARM_CANDIDATE_MULTIPLIER)
  )
}

/** Passages from indexed web pages the team added. */
function webpagePassages(opts: PassageQueryOptions): Promise<RetrievedPassage[]> {
  return bothArms('webpage', opts, (score, match) =>
    db
      .select({
        sourceId: assistantKnowledgeSources.sourceId,
        chunkId: assistantChunks.id,
        generation: assistantSourceVersions.generation,
        contentHash: assistantSourceVersions.contentHash,
        headingPath: assistantChunks.headingPath,
        content: assistantChunks.content,
        score: score.as('score'),
        title: assistantWebSources.title,
        url: assistantWebSources.url,
        updatedAt: assistantWebSources.updatedAt,
        publicToCustomers: assistantWebSources.assistantCustomerUse,
      })
      .from(assistantChunks)
      .innerJoin(assistantSourceVersions, eq(assistantSourceVersions.id, assistantChunks.versionId))
      .innerJoin(
        assistantKnowledgeSources,
        eq(assistantKnowledgeSources.id, assistantChunks.knowledgeSourceId)
      )
      .innerJoin(
        assistantWebSources,
        sql`${assistantWebSources.id} = ${assistantKnowledgeSources.sourceId}`
      )
      .where(
        and(
          ...activeGenerationConditions('webpage'),
          eq(assistantWebSources.enabled, true),
          sourceUseFilter(assistantWebSources, opts.ceiling),
          match
        )
      )
      .orderBy(sql`score DESC`)
      .limit(opts.topK * ARM_CANDIDATE_MULTIPLIER)
  )
}

function mapPassage(
  sourceType: AssistantIndexedSourceType,
  row: PassageRow,
  arm: 'lexical' | 'vector'
): RetrievedPassage {
  return {
    sourceType,
    sourceId: fromUuid(SOURCE_ID_PREFIX[sourceType], row.sourceId),
    chunkId: row.chunkId,
    sourceVersion: `${row.generation}:${row.contentHash.slice(0, 12)}`,
    headingPath: row.headingPath,
    passage: row.content,
    score: Number(row.score),
    arm,
    title: row.title,
    url: row.url,
    updatedAt: row.updatedAt,
    publicToCustomers: row.publicToCustomers,
  }
}

/**
 * Interleave the arms by rank and keep one passage per source.
 *
 * One per source because a citation is per source: two passages of the same
 * article collapse into one citation anyway, and letting a long document take
 * three of the five slots is exactly the source-diversity loss the outer
 * composer's rank interleaving exists to prevent.
 */
export function mergePassagesByRank(arms: RetrievedPassage[][], topK: number): RetrievedPassage[] {
  const ranked = arms.map((arm) => [...arm].sort((a, b) => b.score - a.score))
  const out: RetrievedPassage[] = []
  const seenSources = new Set<string>()
  const deepest = Math.max(0, ...ranked.map((arm) => arm.length))
  for (let rank = 0; rank < deepest && out.length < topK; rank++) {
    const tier = ranked
      .map((arm) => arm[rank])
      .filter((passage): passage is RetrievedPassage => passage !== undefined)
      .sort((a, b) => b.score - a.score)
    for (const passage of tier) {
      if (out.length >= topK) break
      if (seenSources.has(passage.sourceId)) continue
      seenSources.add(passage.sourceId)
      out.push(passage)
    }
  }
  return out
}

/** The indexed passages for one source type, empty when nothing is indexed yet. */
export function retrieveIndexedPassages(
  sourceType: AssistantIndexedSourceType,
  opts: PassageQueryOptions
): Promise<RetrievedPassage[]> {
  switch (sourceType) {
    case 'article':
      return articlePassages(opts)
    case 'document':
      return documentPassages(opts)
    case 'webpage':
      return webpagePassages(opts)
    default: {
      const exhaustive: never = sourceType
      throw new Error(`retrieveIndexedPassages: unhandled source type "${String(exhaustive)}"`)
    }
  }
}

/**
 * Which of these source ids the index already answers for.
 *
 * The whole-source adapters use it to stand down: a source with an active
 * generation is served from its passages and one without is served the old way,
 * so a partially backfilled workspace loses no recall and never shows two
 * excerpts of the same thing.
 */
export async function indexServedSourceIds(
  sourceType: AssistantIndexedSourceType,
  sourceIds: readonly string[]
): Promise<Set<string>> {
  if (sourceIds.length === 0) return new Set()
  const rows = await db
    .select({ sourceId: assistantKnowledgeSources.sourceId })
    .from(assistantKnowledgeSources)
    .innerJoin(
      assistantSourceVersions,
      eq(assistantSourceVersions.id, assistantKnowledgeSources.activeVersionId)
    )
    .where(
      and(
        eq(assistantKnowledgeSources.sourceType, sourceType),
        isNull(assistantKnowledgeSources.tombstonedAt),
        eq(assistantSourceVersions.status, 'active'),
        inArray(assistantKnowledgeSources.sourceId, sourceIds.map(toUuid))
      )
    )
  const prefix = SOURCE_ID_PREFIX[sourceType]
  return new Set(rows.map((row) => fromUuid(prefix, row.sourceId)))
}
