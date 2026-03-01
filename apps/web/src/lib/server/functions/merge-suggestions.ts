/**
 * Server functions for AI merge suggestions.
 *
 * Provides endpoints for querying, accepting, and dismissing
 * AI-generated merge suggestions.
 */

import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { type PostId, type PrincipalId, type MergeSuggestionId } from '@quackback/ids'
import { requireAuth } from './auth-helpers'
import {
  getPendingSuggestionsForPost,
  acceptMergeSuggestion,
  dismissMergeSuggestion,
} from '@/lib/server/domains/merge-suggestions'

// ============================================
// Schemas
// ============================================

const getMergeSuggestionsSchema = z.object({
  postId: z.string(),
})

const acceptMergeSuggestionSchema = z.object({
  suggestionId: z.string(),
})

const dismissMergeSuggestionSchema = z.object({
  suggestionId: z.string(),
})

// ============================================
// Server Functions
// ============================================

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

/**
 * Accept a merge suggestion — performs the actual post merge.
 * Requires admin/member role.
 */
export const acceptMergeSuggestionFn = createServerFn({ method: 'POST' })
  .inputValidator(acceptMergeSuggestionSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:merge-suggestions] acceptMergeSuggestionFn: ${data.suggestionId}`)
    const auth = await requireAuth({ roles: ['admin', 'member'] })
    await acceptMergeSuggestion(
      data.suggestionId as MergeSuggestionId,
      auth.principal.id as PrincipalId
    )
    return { success: true }
  })

/**
 * Dismiss a merge suggestion.
 * Requires admin/member role.
 */
export const dismissMergeSuggestionFn = createServerFn({ method: 'POST' })
  .inputValidator(dismissMergeSuggestionSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:merge-suggestions] dismissMergeSuggestionFn: ${data.suggestionId}`)
    const auth = await requireAuth({ roles: ['admin', 'member'] })
    await dismissMergeSuggestion(
      data.suggestionId as MergeSuggestionId,
      auth.principal.id as PrincipalId
    )
    return { success: true }
  })
