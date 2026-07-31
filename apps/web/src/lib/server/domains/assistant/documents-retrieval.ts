/**
 * Knowledge-document grounding source for Quinn.
 *
 * A `KnowledgeSource` (see `./retrieval-sources`) over `assistant_documents`:
 * the same hybrid retrieval shape as the changelog source — semantic
 * (pgvector cosine over `assistant_documents.embedding`) blended with an
 * ILIKE keyword arm when a query embedding is available, keyword-only
 * otherwise. Documents are embedded at ingest by `document.service.ts`.
 *
 * VISIBILITY: documents are admin-curated, customer-answerable content with
 * no draft or audience state, so every non-deleted row is retrievable at
 * every ceiling — the Agent (public) and the copilot (team) ground on the
 * same corpus. A document has no public page, so its citation carries the
 * title with an empty URL and is never flagged internal.
 */
import { db, assistantDocuments, and, isNull, sql } from '@/lib/server/db'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import type { ContentAudience } from './audience'
import {
  KNOWLEDGE_SNIPPET_CHARS,
  type KnowledgeSource,
  type RetrievedItem,
} from './retrieval-sources'

/** Blend weights for the hybrid score. Mirrors the changelog retrieval tuning. */
export const DOCUMENTS_KEYWORD_WEIGHT = 0.4
export const DOCUMENTS_SEMANTIC_WEIGHT = 0.6

/** Cosine-similarity floor for the semantic arm. Rows below it are absent. */
export const DOCUMENTS_SEMANTIC_SIMILARITY_FLOOR = 0.35

/** Default number of documents retrieved per query. */
export const DOCUMENTS_TOP_K = 5

/** Per-document content budget for the retrieval context (trimmed in SQL). */
export const DOCUMENTS_CONTEXT_CHARS = 4000

export interface RetrievedDocument {
  id: string
  title: string
  content: string
  score: number
  /** The row's last-update timestamp, for the copilot citation freshness line. */
  updatedAt: Date
}

export interface RetrieveDocumentsOptions {
  topK?: number
  minScore?: number
}

interface DocumentRow {
  id: string
  title: string
  content: string
  score: number
  updatedAt: Date
}

/** Select the document content pre-trimmed to the context budget. */
const trimmedContent = () =>
  sql<string>`left(${assistantDocuments.content}, ${DOCUMENTS_CONTEXT_CHARS})`

/**
 * Hybrid retrieval: a document matches on a keyword hit OR a semantic hit
 * above the floor, ranked by the weighted blend. The keyword arm is a
 * case-insensitive substring match over title+content (no tsvector on this
 * table), scored 1 when it matches so the blend still rewards a lexical hit.
 */
async function hybridQuery(
  query: string,
  embedding: number[],
  topK: number,
  minScore: number
): Promise<DocumentRow[]> {
  const vectorStr = `[${embedding.join(',')}]`
  const pattern = `%${query}%`
  const semantic = sql<number>`COALESCE(1 - (${assistantDocuments.embedding} <=> ${vectorStr}::vector), 0)`
  const keyword = sql<number>`(CASE WHEN (${assistantDocuments.title} ILIKE ${pattern} OR ${assistantDocuments.content} ILIKE ${pattern}) THEN 1 ELSE 0 END)`
  // The weights ride as query parameters; without the cast postgres infers
  // their type from the integer CASE arm and rejects the float literal.
  const combined = sql<number>`(${DOCUMENTS_KEYWORD_WEIGHT}::float8 * ${keyword} + ${DOCUMENTS_SEMANTIC_WEIGHT}::float8 * ${semantic})`

  return db
    .select({
      id: assistantDocuments.id,
      title: assistantDocuments.title,
      content: trimmedContent(),
      score: combined.as('score'),
      updatedAt: assistantDocuments.updatedAt,
    })
    .from(assistantDocuments)
    .where(
      and(
        isNull(assistantDocuments.deletedAt),
        sql`(
          (${assistantDocuments.title} ILIKE ${pattern} OR ${assistantDocuments.content} ILIKE ${pattern})
          OR (
            ${assistantDocuments.embedding} IS NOT NULL
            AND 1 - (${assistantDocuments.embedding} <=> ${vectorStr}::vector) > ${minScore}
          )
        )`
      )
    )
    .orderBy(sql`score DESC`)
    .limit(topK)
}

/** Keyword-only fallback when embedding generation is unavailable. An ILIKE
 *  hit carries no relevance signal, so its score is 0 (see the changelog
 *  source for why a no-signal row must sort behind genuinely scored items). */
async function keywordQuery(query: string, topK: number): Promise<DocumentRow[]> {
  const pattern = `%${query}%`

  return db
    .select({
      id: assistantDocuments.id,
      title: assistantDocuments.title,
      content: trimmedContent(),
      score: sql<number>`0`.as('score'),
      updatedAt: assistantDocuments.updatedAt,
    })
    .from(assistantDocuments)
    .where(
      and(
        isNull(assistantDocuments.deletedAt),
        sql`(${assistantDocuments.title} ILIKE ${pattern} OR ${assistantDocuments.content} ILIKE ${pattern})`
      )
    )
    .orderBy(sql`${assistantDocuments.updatedAt} DESC`)
    .limit(topK)
}

/**
 * Retrieve the top-k most relevant knowledge documents for a query. Semantic
 * when a query embedding is available, keyword (ILIKE) otherwise. The ceiling
 * parameter is accepted for the `KnowledgeSource` contract but does not
 * narrow anything: the corpus is the same at every ceiling.
 */
export async function retrieveAssistantDocuments(
  query: string,
  _ceiling: ContentAudience,
  options: RetrieveDocumentsOptions = {}
): Promise<RetrievedDocument[]> {
  const topK = options.topK ?? DOCUMENTS_TOP_K
  const minScore = options.minScore ?? DOCUMENTS_SEMANTIC_SIMILARITY_FLOOR

  const embedding = await generateEmbedding(query, {
    pipelineStep: 'assistant_document_query',
  })

  const rows = embedding
    ? await hybridQuery(query, embedding, topK, minScore)
    : await keywordQuery(query, topK)

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content ?? '',
    score: Number(r.score),
    updatedAt: r.updatedAt,
  }))
}

/**
 * The knowledge-documents `KnowledgeSource`: wraps
 * `retrieveAssistantDocuments`, mapping its rows onto `RetrievedItem`.
 * Dynamically imported by `resolveKnowledgeSources` only when the resolved
 * agent's `documents` knowledge toggle is on.
 */
export const documentsKnowledgeSource: KnowledgeSource = {
  sourceType: 'document',
  async retrieve(query, ceiling) {
    const rows = await retrieveAssistantDocuments(query, ceiling)
    return rows.map(
      (d): RetrievedItem => ({
        id: d.id,
        sourceType: 'document' as const,
        title: d.title,
        excerpt: d.content.slice(0, KNOWLEDGE_SNIPPET_CHARS),
        score: d.score,
        updatedAt: d.updatedAt.toISOString(),
        citation: {
          type: 'document' as const,
          id: d.id,
          title: d.title,
          // No public page exists for an uploaded document: the citation
          // carries its title with an empty URL and never trips the leak gate.
          url: '',
        },
      })
    )
  },
}
