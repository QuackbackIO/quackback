/**
 * Server functions for AI merge suggestions.
 *
 * Provides query endpoint for pending merge suggestions.
 * Accept/dismiss actions are handled via acceptSuggestionFn/dismissSuggestionFn
 * in feedback.ts, which detect the merge_sug prefix and delegate accordingly.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { PostId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import { getPendingSuggestionsForPost } from '@/lib/server/domains/merge-suggestions'

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
    try {
      await requireAuth({ roles: ['admin', 'member'] })
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
