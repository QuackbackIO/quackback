/**
 * Server functions for merge suggestions.
 *
 * Provides query endpoints for pending merge suggestions, summary counts,
 * and per-post counts. Accept/dismiss actions are handled via
 * acceptSuggestionFn/dismissSuggestionFn in feedback.ts.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostId } from '@featurepool/ids'
import { requireAuth } from './auth-helpers'
import {
  getPendingSuggestionsForPost,
  getPendingMergeSuggestionSummary,
  getMergeSuggestionCountsForPosts,
} from '@/lib/server/domains/merge-suggestions/merge-suggestion.service'

// ============================================
// Server Functions
// ============================================

const getMergeSuggestionsSchema = z.object({
  postId: z.string(),
})

/**
 * Get pending merge suggestions for a post.
 * Returns suggestions where the post is either source or target.
 */
export const getMergeSuggestionsForPostFn = createServerFn({ method: 'GET' })
  .inputValidator(getMergeSuggestionsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    try {
      const suggestions = await getPendingSuggestionsForPost(data.postId as PostId)
      return suggestions.map((s) => ({
        ...s,
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
      }))
    } catch (error) {
      console.error(`[fn:merge-suggestions] getMergeSuggestionsForPostFn failed:`, error)
      return []
    }
  })

/**
 * Get total pending merge suggestion count (for summary bar).
 */
export const fetchMergeSuggestionSummaryFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ roles: ['admin', 'member'] })
  try {
    return getPendingMergeSuggestionSummary()
  } catch (error) {
    console.error(`[fn:merge-suggestions] fetchMergeSuggestionSummaryFn failed:`, error)
    return { count: 0 }
  }
})

/**
 * Get merge suggestion counts for a batch of post IDs (for inbox badges).
 */
export const fetchMergeSuggestionCountsForPostsFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ postIds: z.array(z.string()) }))
  .handler(async ({ data }) => {
    await requireAuth({ roles: ['admin', 'member'] })
    try {
      return getMergeSuggestionCountsForPosts(data.postIds as PostId[])
    } catch (error) {
      console.error(`[fn:merge-suggestions] fetchMergeSuggestionCountsForPostsFn failed:`, error)
      return []
    }
  })
