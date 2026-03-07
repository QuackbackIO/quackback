/**
 * Server functions for feedback aggregation operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { FeedbackSourceId, FeedbackSuggestionId, BoardId, PrincipalId } from '@quackback/ids'
import { isTypeId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
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
// Schemas
// ============================================

const listSuggestionsSchema = z.object({
  status: z.enum(['pending', 'accepted', 'dismissed', 'expired']).optional().default('pending'),
  suggestionType: z.enum(['create_post', 'vote_on_post', 'duplicate_post']).optional(),
  boardId: z.string().optional(),
  sourceIds: z.array(z.string()).optional(),
  sort: z.enum(['newest', 'relevance']).optional().default('newest'),
  limit: z.number().optional().default(20),
  offset: z.number().optional().default(0),
})

const acceptSuggestionSchema = z.object({
  id: z.string(),
  edits: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      boardId: z.string().optional(),
      statusId: z.string().optional(),
      authorPrincipalId: z.string().optional(),
    })
    .optional(),
  swapDirection: z.boolean().optional(),
})

const dismissSuggestionSchema = z.object({
  id: z.string(),
})

const retryItemSchema = z.object({
  rawItemId: z.string(),
})

const createSourceSchema = z.object({
  name: z.string().min(1),
  sourceType: z.string(),
  deliveryMode: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
})

const updateSourceSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
})

const deleteSourceSchema = z.object({
  id: z.string(),
})

// ============================================
// Read Operations
// ============================================

export const fetchSuggestions = createServerFn({ method: 'GET' })
  .inputValidator(listSuggestionsSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:feedback] fetchSuggestions: status=${data.status}, sort=${data.sort}, limit=${data.limit}, offset=${data.offset}`
    )
    await requireAuth({ roles: ['admin', 'member'] })

    // If filtering to duplicate_post only, skip feedback suggestions query
    const includeFeedback = data.suggestionType !== 'duplicate_post'
    const includeMerge = !data.suggestionType || data.suggestionType === 'duplicate_post'

    let feedbackItems: any[] = []
    let feedbackTotal = 0

    if (includeFeedback) {
      const conditions: any[] = [eq(feedbackSuggestions.status, data.status ?? 'pending')]
      if (data.suggestionType) {
        conditions.push(eq(feedbackSuggestions.suggestionType, data.suggestionType))
      }
      if (data.boardId) {
        conditions.push(eq(feedbackSuggestions.boardId, data.boardId as BoardId))
      }
      if (data.sourceIds?.length) {
        const matchingRawItemIds = db
          .select({ id: rawFeedbackItems.id })
          .from(rawFeedbackItems)
          .where(inArray(rawFeedbackItems.sourceId, data.sourceIds as FeedbackSourceId[]))
        conditions.push(inArray(feedbackSuggestions.rawFeedbackItemId, matchingRawItemIds))
      }

      const [totalResult] = await db
        .select({ count: count() })
        .from(feedbackSuggestions)
        .where(and(...conditions))

      feedbackTotal = totalResult?.count ?? 0

      const orderBy = [desc(feedbackSuggestions.createdAt)]

      // Fetch enough items to cover the combined offset + limit range
      const fetchUpTo = data.offset + data.limit + 1

      feedbackItems = await db.query.feedbackSuggestions.findMany({
        where: () => and(...conditions),
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
    }

    // Include post-to-post merge suggestions
    let mergeItems: any[] = []
    let mergeTotal = 0

    // Look up quackback source once (used for merge source filtering and per-source counts)
    const quackbackSource = await db.query.feedbackSources.findFirst({
      where: eq(feedbackSources.sourceType, 'quackback'),
      columns: { id: true },
    })

    // Include merge suggestions unless filtered to a non-quackback source or specific board.
    const includesMergeSource =
      !data.sourceIds?.length || (!!quackbackSource && data.sourceIds.includes(quackbackSource.id))

    if (includeMerge && includesMergeSource && !data.boardId) {
      const { getPendingMergeSuggestions } =
        await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')

      const mergeFetchUpTo = data.offset + data.limit + 1
      const { items, total } = await getPendingMergeSuggestions({
        sort: data.sort === 'relevance' ? 'relevance' : 'newest',
        limit: mergeFetchUpTo,
      })

      mergeTotal = total

      mergeItems = items.map((ms: any) => ({
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
    }

    // Compute per-source-type counts across ALL matching suggestions (ignoring pagination)
    const countsBySource: Record<string, number> = {}

    // Count feedback suggestions grouped by source type
    if (includeFeedback) {
      const feedbackCountConditions: any[] = [
        eq(feedbackSuggestions.status, data.status ?? 'pending'),
      ]
      if (data.suggestionType) {
        feedbackCountConditions.push(eq(feedbackSuggestions.suggestionType, data.suggestionType))
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

    // Map feedback items: rename resultPost → targetPost for UI consistency
    const mappedFeedbackItems = feedbackItems.map((item: any) => {
      const { resultPost, ...rest } = item
      return {
        ...rest,
        targetPost: resultPost ? { ...resultPost, status: null } : null,
        sourcePost: null,
      }
    })

    // Combine and sort across both sources
    const allSorted = [...mappedFeedbackItems, ...mergeItems].sort((a, b) => {
      if (data.sort === 'relevance') {
        return (b.similarityScore ?? 0) - (a.similarityScore ?? 0)
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })

    // Slice to the requested page
    const hasMore = allSorted.length > data.offset + data.limit
    const pageItems = allSorted.slice(data.offset, data.offset + data.limit)

    return {
      items: pageItems,
      total: feedbackTotal + mergeTotal,
      countsBySource,
      nextCursor: hasMore ? String(data.offset + data.limit) : null,
      hasMore,
    }
  })

/**
 * Count pending create_post suggestions (for sidebar badge).
 */
export const fetchIncomingSuggestionCount = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin', 'member'] })
  const [result] = await db
    .select({ count: count() })
    .from(feedbackSuggestions)
    .where(
      and(
        eq(feedbackSuggestions.status, 'pending'),
        inArray(feedbackSuggestions.suggestionType, ['create_post', 'vote_on_post'])
      )
    )
  return { count: result?.count ?? 0 }
})

export const fetchFeedbackSources = createServerFn({ method: 'GET' }).handler(async () => {
  console.log(`[fn:feedback] fetchFeedbackSources`)
  await requireAuth({ roles: ['admin', 'member'] })

  const sources = await db.query.feedbackSources.findMany({
    orderBy: [desc(feedbackSources.createdAt)],
  })

  // Add item counts per source
  const sourcesWithCounts = await Promise.all(
    sources.map(async (source) => {
      const [result] = await db
        .select({ count: count() })
        .from(rawFeedbackItems)
        .where(eq(rawFeedbackItems.sourceId, source.id))
      return { ...source, itemCount: result?.count ?? 0 }
    })
  )

  return sourcesWithCounts as any
})

// ============================================
// Write Operations
// ============================================

export const acceptSuggestionFn = createServerFn({ method: 'POST' })
  .inputValidator(acceptSuggestionSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:feedback] acceptSuggestionFn: id=${data.id}, swapDirection=${data.swapDirection}`
    )
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      // Handle post-to-post merge suggestions (TypeID prefix: merge_sug)
      if (isTypeId(data.id, 'merge_sug')) {
        const { acceptMergeSuggestion: acceptPostMerge } =
          await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
        await acceptPostMerge(data.id, auth.principal.id as PrincipalId, {
          swapDirection: data.swapDirection,
        })
        return { success: true }
      }

      const suggestion = await db.query.feedbackSuggestions.findFirst({
        where: eq(feedbackSuggestions.id, data.id as FeedbackSuggestionId),
        columns: { id: true, suggestionType: true, status: true },
      })

      if (!suggestion || suggestion.status !== 'pending') {
        return { success: false, error: 'Suggestion not found or already resolved' }
      }

      // vote_on_post with no edits → cast proxy vote
      // vote_on_post with edits → admin chose "Create instead", treat as create
      if (suggestion.suggestionType === 'vote_on_post' && !data.edits) {
        const { acceptVoteSuggestion } =
          await import('@/lib/server/domains/feedback/pipeline/suggestion.service')

        const result = await acceptVoteSuggestion(
          data.id as FeedbackSuggestionId,
          auth.principal.id as PrincipalId
        )
        return { success: true, resultPostId: result.resultPostId }
      }

      const { acceptCreateSuggestion } =
        await import('@/lib/server/domains/feedback/pipeline/suggestion.service')

      const result = await acceptCreateSuggestion(
        data.id as FeedbackSuggestionId,
        auth.principal.id as PrincipalId,
        data.edits
      )
      return { success: true, resultPostId: result.resultPostId }
    } catch (error) {
      console.error(`[fn:feedback] acceptSuggestionFn failed:`, error)
      throw error
    }
  })

export const dismissSuggestionFn = createServerFn({ method: 'POST' })
  .inputValidator(dismissSuggestionSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:feedback] dismissSuggestionFn: id=${data.id}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })

      // Handle post-to-post merge suggestions (TypeID prefix: merge_sug)
      if (isTypeId(data.id, 'merge_sug')) {
        const { dismissMergeSuggestion } =
          await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
        await dismissMergeSuggestion(data.id, auth.principal.id as PrincipalId)
        return { success: true }
      }

      const { dismissSuggestion } =
        await import('@/lib/server/domains/feedback/pipeline/suggestion.service')

      await dismissSuggestion(data.id as FeedbackSuggestionId, auth.principal.id as PrincipalId)

      return { success: true }
    } catch (error) {
      console.error(`[fn:feedback] dismissSuggestionFn failed:`, error)
      throw error
    }
  })

export const retryFailedItemFn = createServerFn({ method: 'POST' })
  .inputValidator(retryItemSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:feedback] retryFailedItemFn: rawItemId=${data.rawItemId}`)
    try {
      await requireAuth({ roles: ['admin', 'member'] })

      const { enqueueFeedbackAiJob } =
        await import('@/lib/server/domains/feedback/queues/feedback-ai-queue')

      await db
        .update(rawFeedbackItems)
        .set({
          processingState: 'ready_for_extraction',
          stateChangedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(rawFeedbackItems.id, data.rawItemId as any))

      await enqueueFeedbackAiJob({ type: 'extract-signals', rawItemId: data.rawItemId })

      return { success: true }
    } catch (error) {
      console.error(`[fn:feedback] retryFailedItemFn failed:`, error)
      throw error
    }
  })

export const retryAllFailedItemsFn = createServerFn({ method: 'POST' }).handler(async () => {
  console.log(`[fn:feedback] retryAllFailedItemsFn`)
  try {
    await requireAuth({ roles: ['admin', 'member'] })

    const { enqueueFeedbackAiJob } =
      await import('@/lib/server/domains/feedback/queues/feedback-ai-queue')

    // Find all failed items
    const failedItems = await db.query.rawFeedbackItems.findMany({
      where: eq(rawFeedbackItems.processingState, 'failed'),
      columns: { id: true },
    })

    if (failedItems.length === 0) return { retriedCount: 0 }

    // Reset state and re-enqueue
    await db
      .update(rawFeedbackItems)
      .set({
        processingState: 'ready_for_extraction',
        stateChangedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(rawFeedbackItems.processingState, 'failed'))

    for (const item of failedItems) {
      await enqueueFeedbackAiJob({ type: 'extract-signals', rawItemId: item.id })
    }

    return { retriedCount: failedItems.length }
  } catch (error) {
    console.error(`[fn:feedback] retryAllFailedItemsFn failed:`, error)
    throw error
  }
})

export const createFeedbackSourceFn = createServerFn({ method: 'POST' })
  .inputValidator(createSourceSchema)
  .handler(async ({ data }) => {
    console.log(
      `[fn:feedback] createFeedbackSourceFn: name=${data.name}, sourceType=${data.sourceType}, deliveryMode=${data.deliveryMode}`
    )
    try {
      await requireAuth({ roles: ['admin'] })

      const [source] = await db
        .insert(feedbackSources)
        .values({
          name: data.name,
          sourceType: data.sourceType,
          deliveryMode: data.deliveryMode,
          config: data.config ?? {},
        })
        .returning()

      return source as any
    } catch (error) {
      console.error(`[fn:feedback] createFeedbackSourceFn failed:`, error)
      throw error
    }
  })

export const updateFeedbackSourceFn = createServerFn({ method: 'POST' })
  .inputValidator(updateSourceSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:feedback] updateFeedbackSourceFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin'] })

      const updates: Record<string, unknown> = { updatedAt: new Date() }
      if (data.name !== undefined) updates.name = data.name
      if (data.enabled !== undefined) updates.enabled = data.enabled
      if (data.config !== undefined) updates.config = data.config

      const [updated] = await db
        .update(feedbackSources)
        .set(updates)
        .where(eq(feedbackSources.id, data.id as FeedbackSourceId))
        .returning()

      return updated as any
    } catch (error) {
      console.error(`[fn:feedback] updateFeedbackSourceFn failed:`, error)
      throw error
    }
  })

export const deleteFeedbackSourceFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteSourceSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:feedback] deleteFeedbackSourceFn: id=${data.id}`)
    try {
      await requireAuth({ roles: ['admin'] })

      await db.delete(feedbackSources).where(eq(feedbackSources.id, data.id as FeedbackSourceId))

      return { success: true }
    } catch (error) {
      console.error(`[fn:feedback] deleteFeedbackSourceFn failed:`, error)
      throw error
    }
  })
