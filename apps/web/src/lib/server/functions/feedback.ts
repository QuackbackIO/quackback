/**
 * Server functions for feedback aggregation operations
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type {
  FeedbackSourceId,
  FeedbackSuggestionId,
  PrincipalId,
  RawFeedbackItemId,
} from '@quackback/ids'
import { isTypeId } from '@quackback/ids'

import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
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
import { listSuggestions } from '@/lib/server/domains/feedback/suggestion.query'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'feedback' })

// ============================================
// Schemas
// ============================================

const listSuggestionsSchema = z.object({
  status: z.enum(['pending', 'accepted', 'dismissed', 'expired']).optional().default('pending'),
  suggestionType: z.enum(['create_post', 'vote_on_post', 'duplicate_post']).optional(),
  boardId: z.string().optional(),
  sourceIds: z.array(z.string()).optional(),
  sourceTypes: z.array(z.string()).optional(),
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
  .validator(listSuggestionsSchema)
  .handler(async ({ data }) => {
    log.debug(
      { status: data.status, sort: data.sort, limit: data.limit, offset: data.offset },
      'fetch suggestions'
    )
    await requireAuth({ permission: PERMISSIONS.SUGGESTION_VIEW })

    return listSuggestions({
      status: data.status ?? 'pending',
      suggestionType: data.suggestionType,
      boardId: data.boardId,
      sourceIds: data.sourceIds,
      sourceTypes: data.sourceTypes,
      sort: data.sort ?? 'newest',
      limit: data.limit ?? 20,
      offset: data.offset ?? 0,
    })
  })

/**
 * Count pending and dismissed suggestions (for sidebar badge + toggle).
 */
export const fetchIncomingSuggestionCount = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.SUGGESTION_VIEW })

  const typeFilter = inArray(feedbackSuggestions.suggestionType, ['create_post', 'vote_on_post'])

  const [[pendingResult], [dismissedResult]] = await Promise.all([
    db
      .select({ count: count() })
      .from(feedbackSuggestions)
      .where(and(eq(feedbackSuggestions.status, 'pending'), typeFilter)),
    db
      .select({ count: count() })
      .from(feedbackSuggestions)
      .where(and(eq(feedbackSuggestions.status, 'dismissed'), typeFilter)),
  ])

  return {
    count: pendingResult?.count ?? 0,
    dismissedCount: dismissedResult?.count ?? 0,
  }
})

export const fetchFeedbackSources = createServerFn({ method: 'GET' }).handler(async () => {
  log.debug('fetch feedback sources')
  await requireAuth({ permission: PERMISSIONS.INTEGRATION_VIEW })

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

  return sourcesWithCounts.map((s) => ({
    ...s,
    config: s.config as Record<string, never>,
  }))
})

// ============================================
// Write Operations
// ============================================

export const acceptSuggestionFn = createServerFn({ method: 'POST' })
  .validator(acceptSuggestionSchema)
  .handler(async ({ data }) => {
    log.debug({ suggestion_id: data.id, swap_direction: data.swapDirection }, 'accept suggestion')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.SUGGESTION_MANAGE })

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

      // Strip authorPrincipalId from edits for non-admin callers
      const safeEdits =
        data.edits && auth.principal.role !== 'admin'
          ? { ...data.edits, authorPrincipalId: undefined }
          : data.edits

      const result = await acceptCreateSuggestion(
        data.id as FeedbackSuggestionId,
        auth.principal.id as PrincipalId,
        safeEdits
      )
      return { success: true, resultPostId: result.resultPostId }
    } catch (error) {
      log.error({ err: error }, 'accept suggestion failed')
      throw error
    }
  })

export const dismissSuggestionFn = createServerFn({ method: 'POST' })
  .validator(dismissSuggestionSchema)
  .handler(async ({ data }) => {
    log.debug({ suggestion_id: data.id }, 'dismiss suggestion')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.SUGGESTION_MANAGE })

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
      log.error({ err: error }, 'dismiss suggestion failed')
      throw error
    }
  })

export const restoreSuggestionFn = createServerFn({ method: 'POST' })
  .validator(dismissSuggestionSchema)
  .handler(async ({ data }) => {
    log.debug({ suggestion_id: data.id }, 'restore suggestion')
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.SUGGESTION_MANAGE })

      // Handle post-to-post merge suggestions (TypeID prefix: merge_sug)
      if (isTypeId(data.id, 'merge_sug')) {
        const { restoreMergeSuggestion } =
          await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
        await restoreMergeSuggestion(data.id, auth.principal.id as PrincipalId)
        return { success: true }
      }

      const { restoreSuggestion } =
        await import('@/lib/server/domains/feedback/pipeline/suggestion.service')

      await restoreSuggestion(data.id as FeedbackSuggestionId, auth.principal.id as PrincipalId)

      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'restore suggestion failed')
      throw error
    }
  })

export const retryFailedItemFn = createServerFn({ method: 'POST' })
  .validator(retryItemSchema)
  .handler(async ({ data }) => {
    log.debug({ raw_item_id: data.rawItemId }, 'retry failed item')
    try {
      await requireAuth({ permission: PERMISSIONS.SUGGESTION_MANAGE })

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
        .where(eq(rawFeedbackItems.id, data.rawItemId as RawFeedbackItemId))

      await enqueueFeedbackAiJob({ type: 'extract-signals', rawItemId: data.rawItemId })

      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'retry failed item failed')
      throw error
    }
  })

export const retryAllFailedItemsFn = createServerFn({ method: 'POST' }).handler(async () => {
  log.debug('retry all failed items')
  try {
    await requireAuth({ permission: PERMISSIONS.SUGGESTION_MANAGE })

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
    log.error({ err: error }, 'retry all failed items failed')
    throw error
  }
})

export const createFeedbackSourceFn = createServerFn({ method: 'POST' })
  .validator(createSourceSchema)
  .handler(async ({ data }) => {
    log.debug(
      { source_type: data.sourceType, delivery_mode: data.deliveryMode },
      'create feedback source'
    )
    try {
      await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

      const [source] = await db
        .insert(feedbackSources)
        .values({
          name: data.name,
          sourceType: data.sourceType,
          deliveryMode: data.deliveryMode,
          config: data.config ?? {},
        })
        .returning()

      return { ...source, config: source.config as Record<string, never> }
    } catch (error) {
      log.error({ err: error }, 'create feedback source failed')
      throw error
    }
  })

export const updateFeedbackSourceFn = createServerFn({ method: 'POST' })
  .validator(updateSourceSchema)
  .handler(async ({ data }) => {
    log.debug({ source_id: data.id }, 'update feedback source')
    try {
      await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

      const updates: Record<string, unknown> = { updatedAt: new Date() }
      if (data.name !== undefined) updates.name = data.name
      if (data.enabled !== undefined) updates.enabled = data.enabled
      if (data.config !== undefined) updates.config = data.config

      const [updated] = await db
        .update(feedbackSources)
        .set(updates)
        .where(eq(feedbackSources.id, data.id as FeedbackSourceId))
        .returning()

      return { ...updated, config: updated.config as Record<string, never> }
    } catch (error) {
      log.error({ err: error }, 'update feedback source failed')
      throw error
    }
  })

export const deleteFeedbackSourceFn = createServerFn({ method: 'POST' })
  .validator(deleteSourceSchema)
  .handler(async ({ data }) => {
    log.debug({ source_id: data.id }, 'delete feedback source')
    try {
      await requireAuth({ permission: PERMISSIONS.INTEGRATION_MANAGE })

      await db.delete(feedbackSources).where(eq(feedbackSources.id, data.id as FeedbackSourceId))

      return { success: true }
    } catch (error) {
      log.error({ err: error }, 'delete feedback source failed')
      throw error
    }
  })
