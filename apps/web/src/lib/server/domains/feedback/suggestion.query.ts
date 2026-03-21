/**
 * Suggestion Query Service
 *
 * Shared query logic for listing AI-generated feedback suggestions.
 * Used by both TanStack server functions (admin UI) and MCP tools / REST API.
 */

import type { BoardId, FeedbackSourceId } from '@quackback/ids'
import type { SQL } from 'drizzle-orm'
import {
  db,
  eq,
  and,
  desc,
  inArray,
  feedbackSuggestions,
  rawFeedbackItems,
  feedbackSources,
  count,
} from '@/lib/server/db'

// ============================================
// Types
// ============================================

export interface ListSuggestionsParams {
  status: 'pending' | 'accepted' | 'dismissed' | 'expired'
  suggestionType?: 'create_post' | 'vote_on_post' | 'duplicate_post'
  boardId?: string
  sourceIds?: string[]
  sourceTypes?: string[]
  sort: 'newest' | 'relevance'
  limit: number
  offset: number
}

export interface ListSuggestionsResult {
  items: SuggestionItem[]
  total: number
  countsBySource: Record<string, number>
  nextCursor: string | null
  hasMore: boolean
}

export interface SuggestionItem {
  id: string
  suggestionType: string
  status: string
  similarityScore: number | null
  suggestedTitle: string | null
  suggestedBody: string | null
  reasoning: string | null
  createdAt: Date
  updatedAt: Date
  rawItem: {
    id: string
    sourceType: string
    externalUrl: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    author: Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content: any
    sourceCreatedAt: Date
    source: { id: string; name: string; sourceType: string } | null
  } | null
  targetPost: {
    id: string
    title: string
    content: string | null
    voteCount: number
    createdAt: Date
    status: null
  } | null
  sourcePost: {
    id: string
    title: string
    content: string | null
    voteCount: number
    commentCount: number
    createdAt: Date
    boardName: string | null
    statusName: string | null
    statusColor: string | null
  } | null
  board: { id: string; name: string; slug: string } | null
  signal: {
    id: string
    signalType: string
    summary: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evidence: any
    extractionConfidence: number | null
  } | null
}

// ============================================
// Query
// ============================================

/**
 * List suggestions with filtering, sorting, and pagination.
 * Merges feedback suggestions and merge suggestions into a unified list.
 *
 * Caller is responsible for auth checks before calling this function.
 */
export async function listSuggestions(
  params: ListSuggestionsParams
): Promise<ListSuggestionsResult> {
  // If filtering to duplicate_post only, skip feedback suggestions query
  const includeFeedback = params.suggestionType !== 'duplicate_post'
  const includeMerge = params.suggestionType === 'duplicate_post'

  const feedbackQuery = async () => {
    const conditions: SQL[] = [eq(feedbackSuggestions.status, params.status ?? 'pending')]
    if (params.suggestionType) {
      conditions.push(eq(feedbackSuggestions.suggestionType, params.suggestionType))
    }
    if (params.boardId) {
      conditions.push(eq(feedbackSuggestions.boardId, params.boardId as BoardId))
    }
    if (params.sourceIds?.length) {
      const matchingRawItemIds = db
        .select({ id: rawFeedbackItems.id })
        .from(rawFeedbackItems)
        .where(inArray(rawFeedbackItems.sourceId, params.sourceIds as FeedbackSourceId[]))
      conditions.push(inArray(feedbackSuggestions.rawFeedbackItemId, matchingRawItemIds))
    }
    if (params.sourceTypes?.length) {
      const matchingRawItemIds = db
        .select({ id: rawFeedbackItems.id })
        .from(rawFeedbackItems)
        .where(inArray(rawFeedbackItems.sourceType, params.sourceTypes))
      conditions.push(inArray(feedbackSuggestions.rawFeedbackItemId, matchingRawItemIds))
    }

    const [totalResult] = await db
      .select({ count: count() })
      .from(feedbackSuggestions)
      .where(and(...conditions))

    const orderBy = [desc(feedbackSuggestions.createdAt)]

    // Fetch enough items to cover the combined offset + limit range
    const fetchUpTo = params.offset + params.limit + 1

    const rows = await db.query.feedbackSuggestions.findMany({
      where: () => and(...conditions),
      columns: {
        // Exclude embedding vectors — large and not needed for display
        embedding: false,
      },
      orderBy,
      limit: fetchUpTo,
      with: {
        rawItem: {
          columns: {
            id: true,
            sourceType: true,
            externalUrl: true,
            author: true,
            content: true,
            sourceCreatedAt: true,
            principalId: true,
          },
          with: {
            source: { columns: { id: true, name: true, sourceType: true } },
          },
        },
        board: { columns: { id: true, name: true, slug: true } },
        resultPost: {
          columns: { id: true, title: true, content: true, voteCount: true, createdAt: true },
        },
        signal: {
          columns: {
            id: true,
            signalType: true,
            summary: true,
            evidence: true,
            extractionConfidence: true,
          },
        },
      },
    })

    return { rows, total: totalResult?.count ?? 0 }
  }

  const feedbackResult = includeFeedback ? await feedbackQuery() : null
  const feedbackItems = feedbackResult?.rows ?? []
  const feedbackTotal = feedbackResult?.total ?? 0

  // Look up quackback source once (used for merge source filtering and per-source counts)
  const quackbackSource = await db.query.feedbackSources.findFirst({
    where: eq(feedbackSources.sourceType, 'quackback'),
    columns: { id: true },
  })

  // Include merge suggestions unless filtered to a non-quackback source or specific board
  const includesMergeSource =
    !params.sourceIds?.length ||
    (!!quackbackSource && params.sourceIds.includes(quackbackSource.id))

  const mergeQuery = async () => {
    const { getPendingMergeSuggestions } =
      await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')

    const mergeFetchUpTo = params.offset + params.limit + 1
    const { items, total } = await getPendingMergeSuggestions({
      sort: params.sort === 'relevance' ? 'relevance' : 'newest',
      limit: mergeFetchUpTo,
    })

    const mapped = items.map((ms) => ({
      id: ms.id,
      suggestionType: 'duplicate_post' as const,
      status: ms.status,
      similarityScore: ms.hybridScore,
      suggestedTitle: null,
      suggestedBody: null,
      reasoning: ms.llmReasoning,
      createdAt: ms.createdAt,
      updatedAt: ms.updatedAt,
      rawItem: null,
      targetPost: ms.targetPost ? { ...ms.targetPost, status: null } : null,
      sourcePost: ms.sourcePost ?? null,
      similarPosts: null,
      board: null,
      signal: null,
    }))

    return { items: mapped, total }
  }

  const mergeResult =
    includeMerge && includesMergeSource && !params.boardId ? await mergeQuery() : null
  const mergeItems = mergeResult?.items ?? []
  const mergeTotal = mergeResult?.total ?? 0

  // Compute per-source-type counts across ALL matching suggestions (ignoring pagination)
  const countsBySource: Record<string, number> = {}

  if (includeFeedback) {
    const feedbackCountConditions: SQL[] = [
      eq(feedbackSuggestions.status, params.status ?? 'pending'),
    ]
    if (params.suggestionType) {
      feedbackCountConditions.push(eq(feedbackSuggestions.suggestionType, params.suggestionType))
    }

    const feedbackCountsBySourceType = await db
      .select({
        sourceType: rawFeedbackItems.sourceType,
        count: count(),
      })
      .from(feedbackSuggestions)
      .innerJoin(rawFeedbackItems, eq(feedbackSuggestions.rawFeedbackItemId, rawFeedbackItems.id))
      .where(and(...feedbackCountConditions))
      .groupBy(rawFeedbackItems.sourceType)

    for (const row of feedbackCountsBySourceType) {
      if (row.sourceType) {
        countsBySource[row.sourceType] = row.count
      }
    }
  }

  // Attribute merge suggestion count to quackback source type
  if (includeMerge && mergeTotal > 0) {
    countsBySource['quackback'] = (countsBySource['quackback'] ?? 0) + mergeTotal
  }

  // Map feedback items: rename resultPost -> targetPost for consistency
  const mappedFeedbackItems = feedbackItems.map((item) => {
    const { resultPost, rawItem, ...rest } = item
    return {
      ...rest,
      rawItem: rawItem
        ? {
            ...rawItem,
            author: rawItem.author as Record<string, unknown>,
          }
        : null,
      targetPost: resultPost ? { ...resultPost, status: null } : null,
      sourcePost: null,
    }
  })

  // Combine and sort across both sources
  const allSorted = [...mappedFeedbackItems, ...mergeItems].sort((a, b) => {
    if (params.sort === 'relevance') {
      const scoreB = 'similarityScore' in b ? (b.similarityScore ?? 0) : 0
      const scoreA = 'similarityScore' in a ? (a.similarityScore ?? 0) : 0
      return scoreB - scoreA
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  // Slice to the requested page
  const hasMore = allSorted.length > params.offset + params.limit
  const pageItems = allSorted.slice(params.offset, params.offset + params.limit)

  return {
    items: pageItems as SuggestionItem[],
    total: feedbackTotal + mergeTotal,
    countsBySource,
    nextCursor: hasMore ? String(params.offset + params.limit) : null,
    hasMore,
  }
}
