/**
 * Server functions for feedback aggregation operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { FeedbackSourceId, FeedbackSuggestionId, BoardId, PrincipalId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import {
  db,
  eq,
  and,
  desc,
  inArray,
  feedbackSuggestions,
  feedbackSignals,
  rawFeedbackItems,
  feedbackSources,
  count,
} from '@/lib/server/db'

// ============================================
// Schemas
// ============================================

const listSuggestionsSchema = z.object({
  status: z.enum(['pending', 'accepted', 'dismissed', 'expired']).optional().default('pending'),
  suggestionType: z.enum(['merge_post', 'create_post']).optional(),
  boardId: z.string().optional(),
  sourceIds: z.array(z.string()).optional(),
  sort: z.enum(['newest', 'similarity', 'confidence']).optional().default('newest'),
  limit: z.number().optional().default(50),
  offset: z.number().optional().default(0),
})

const getSuggestionSchema = z.object({
  id: z.string(),
})

const acceptSuggestionSchema = z.object({
  id: z.string(),
  edits: z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      boardId: z.string().optional(),
    })
    .optional(),
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
    await requireAuth({ roles: ['admin', 'member'] })

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

    const orderBy =
      data.sort === 'similarity'
        ? [desc(feedbackSuggestions.similarityScore), desc(feedbackSuggestions.createdAt)]
        : [desc(feedbackSuggestions.createdAt)]

    const suggestions = await db.query.feedbackSuggestions.findMany({
      where: () => and(...conditions),
      orderBy,
      limit: data.limit,
      offset: data.offset,
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
        targetPost: {
          columns: { id: true, title: true, voteCount: true, statusId: true, boardId: true },
          with: { postStatus: { columns: { id: true, name: true, color: true } } },
        },
        board: { columns: { id: true, name: true, slug: true } },
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

    return {
      items: suggestions as any,
      total: totalResult?.count ?? 0,
    }
  })

export const fetchSuggestionDetail = createServerFn({ method: 'GET' })
  .inputValidator(getSuggestionSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })

    const suggestion = await db.query.feedbackSuggestions.findFirst({
      where: eq(feedbackSuggestions.id, data.id as FeedbackSuggestionId),
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
        targetPost: {
          columns: { id: true, title: true, voteCount: true, statusId: true, boardId: true },
          with: { postStatus: { columns: { id: true, name: true, color: true } } },
        },
        resultPost: {
          columns: { id: true, title: true },
        },
        board: { columns: { id: true, name: true, slug: true } },
        signal: {
          columns: {
            id: true,
            signalType: true,
            summary: true,
            evidence: true,
            implicitNeed: true,
            extractionConfidence: true,
          },
        },
      },
    })

    if (!suggestion) return null

    return suggestion as any
  })

export const fetchSuggestionStats = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin', 'member'] })

  const results = await db
    .select({
      suggestionType: feedbackSuggestions.suggestionType,
      count: count(),
    })
    .from(feedbackSuggestions)
    .where(eq(feedbackSuggestions.status, 'pending'))
    .groupBy(feedbackSuggestions.suggestionType)

  const stats: Record<string, number> = { merge_post: 0, create_post: 0, total: 0 }
  for (const r of results) {
    stats[r.suggestionType] = r.count
    stats.total += r.count
  }

  return stats
})

export const fetchFeedbackPipelineStats = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin', 'member'] })

  const [rawCounts, signalCounts, suggestionCounts] = await Promise.all([
    db
      .select({
        state: rawFeedbackItems.processingState,
        count: count(),
      })
      .from(rawFeedbackItems)
      .groupBy(rawFeedbackItems.processingState),
    db
      .select({
        state: feedbackSignals.processingState,
        count: count(),
      })
      .from(feedbackSignals)
      .groupBy(feedbackSignals.processingState),
    db
      .select({ count: count() })
      .from(feedbackSuggestions)
      .where(eq(feedbackSuggestions.status, 'pending')),
  ])

  return {
    rawItems: Object.fromEntries(rawCounts.map((r) => [r.state, r.count])),
    signals: Object.fromEntries(signalCounts.map((r) => [r.state, r.count])),
    pendingSuggestions: suggestionCounts[0]?.count ?? 0,
  }
})

export const fetchFeedbackSources = createServerFn({ method: 'GET' }).handler(async () => {
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
    const auth = await requireAuth({ roles: ['admin', 'member'] })

    const suggestion = await db.query.feedbackSuggestions.findFirst({
      where: eq(feedbackSuggestions.id, data.id as FeedbackSuggestionId),
      columns: { id: true, suggestionType: true, status: true },
    })

    if (!suggestion || suggestion.status !== 'pending') {
      return { success: false, error: 'Suggestion not found or already resolved' }
    }

    const { acceptMergeSuggestion, acceptCreateSuggestion } =
      await import('@/lib/server/domains/feedback/pipeline/suggestion.service')

    if (suggestion.suggestionType === 'merge_post') {
      const result = await acceptMergeSuggestion(
        data.id as FeedbackSuggestionId,
        auth.principal.id as PrincipalId
      )
      return { success: true, resultPostId: result.resultPostId }
    } else {
      const result = await acceptCreateSuggestion(
        data.id as FeedbackSuggestionId,
        auth.principal.id as PrincipalId,
        data.edits
      )
      return { success: true, resultPostId: result.resultPostId }
    }
  })

export const dismissSuggestionFn = createServerFn({ method: 'POST' })
  .inputValidator(dismissSuggestionSchema)
  .handler(async ({ data }) => {
    const auth = await requireAuth({ roles: ['admin', 'member'] })

    const { dismissSuggestion } =
      await import('@/lib/server/domains/feedback/pipeline/suggestion.service')

    await dismissSuggestion(data.id as FeedbackSuggestionId, auth.principal.id as PrincipalId)

    return { success: true }
  })

export const retryFailedItemFn = createServerFn({ method: 'POST' })
  .inputValidator(retryItemSchema)
  .handler(async ({ data }) => {
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
  })

export const retryAllFailedItemsFn = createServerFn({ method: 'POST' }).handler(async () => {
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
})

export const createFeedbackSourceFn = createServerFn({ method: 'POST' })
  .inputValidator(createSourceSchema)
  .handler(async ({ data }) => {
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
  })

export const updateFeedbackSourceFn = createServerFn({ method: 'POST' })
  .inputValidator(updateSourceSchema)
  .handler(async ({ data }) => {
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
  })

export const deleteFeedbackSourceFn = createServerFn({ method: 'POST' })
  .inputValidator(deleteSourceSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin'] })

    await db.delete(feedbackSources).where(eq(feedbackSources.id, data.id as FeedbackSourceId))

    return { success: true }
  })
