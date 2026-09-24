/**
 * Server functions for merge suggestions.
 *
 * Provides query endpoints for pending merge suggestions, summary counts,
 * and per-post counts. Accept/dismiss actions are handled via
 * acceptSuggestionFn/dismissSuggestionFn in feedback.ts.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  getPendingMergeSuggestionSummary,
  getMergeSuggestionCountsForPosts,
} from '@/lib/server/domains/merge-suggestions/merge-suggestion.service'
import { loadMergeSuggestionsPanel } from '@/lib/server/domains/posts/post.admin-panels'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'merge-suggestions' })

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
  .validator(getMergeSuggestionsSchema)
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
    return loadMergeSuggestionsPanel(data.postId as PostId)
  })

/**
 * Get total pending merge suggestion count (for summary bar).
 */
export const fetchMergeSuggestionSummaryFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
  try {
    return getPendingMergeSuggestionSummary()
  } catch (error) {
    log.error({ err: error }, 'fetch merge suggestion summary failed')
    return { count: 0 }
  }
})

/**
 * Get merge suggestion counts for a batch of post IDs (for inbox badges).
 */
export const fetchMergeSuggestionCountsForPostsFn = createServerFn({ method: 'POST' })
  .validator(z.object({ postIds: z.array(z.string()) }))
  .handler(async ({ data }) => {
    await requireAuth({ permission: PERMISSIONS.POST_VIEW_PRIVATE })
    try {
      return getMergeSuggestionCountsForPosts(data.postIds as PostId[])
    } catch (error) {
      log.error({ err: error }, 'fetch merge suggestion counts for posts failed')
      return []
    }
  })
