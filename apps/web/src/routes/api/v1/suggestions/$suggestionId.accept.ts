import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { isTypeId, isValidTypeId } from '@quackback/ids'
import type { FeedbackSuggestionId, MergeSuggestionId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/suggestions/$suggestionId/accept')({
  server: {
    handlers: {
      /**
       * POST /api/v1/suggestions/:suggestionId/accept
       * Accept an AI-generated suggestion
       */
      POST: async ({ request, params }) => {
        try {
          const { principalId } = await withApiKeyAuth(request, { role: 'team' })
          const { suggestionId } = params

          // Validate suggestion ID format
          if (
            !isValidTypeId(suggestionId, 'feedback_suggestion') &&
            !isValidTypeId(suggestionId, 'merge_sug')
          ) {
            return badRequestResponse(
              'Invalid suggestion ID format. Expected feedback_suggestion_xxx or merge_sug_xxx'
            )
          }

          // Parse optional body
          let body: {
            edits?: { title?: string; body?: string; boardId?: string; statusId?: string }
            swapDirection?: boolean
          } = {}
          try {
            body = await request.json()
          } catch {
            // Empty body is ok
          }

          // Route to merge suggestion handler
          if (isTypeId(suggestionId, 'merge_sug')) {
            const { acceptMergeSuggestion } =
              await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
            await acceptMergeSuggestion(suggestionId as MergeSuggestionId, principalId, {
              swapDirection: body.swapDirection,
            })
            return successResponse({ accepted: true, id: suggestionId })
          }

          // Feedback suggestion
          const { db, feedbackSuggestions, eq } = await import('@/lib/server/db')
          const suggestion = await db.query.feedbackSuggestions.findFirst({
            where: eq(feedbackSuggestions.id, suggestionId as FeedbackSuggestionId),
            columns: { id: true, suggestionType: true, status: true },
          })

          if (!suggestion || suggestion.status !== 'pending') {
            return badRequestResponse('Suggestion not found or already resolved')
          }

          // vote_on_post with no edits → proxy vote
          if (suggestion.suggestionType === 'vote_on_post' && !body.edits) {
            const { acceptVoteSuggestion } =
              await import('@/lib/server/domains/feedback/pipeline/suggestion.service')
            const result = await acceptVoteSuggestion(
              suggestionId as FeedbackSuggestionId,
              principalId
            )
            return successResponse({
              accepted: true,
              id: suggestionId,
              resultPostId: result.resultPostId,
            })
          }

          // create_post or vote_on_post with edits → create post
          const { acceptCreateSuggestion } =
            await import('@/lib/server/domains/feedback/pipeline/suggestion.service')
          const result = await acceptCreateSuggestion(
            suggestionId as FeedbackSuggestionId,
            principalId,
            body.edits
          )
          return successResponse({
            accepted: true,
            id: suggestionId,
            resultPostId: result.resultPostId,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
