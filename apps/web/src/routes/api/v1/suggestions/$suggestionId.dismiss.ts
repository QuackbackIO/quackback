import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { isTypeId, isValidTypeId } from '@quackback/ids'
import type { FeedbackSuggestionId, MergeSuggestionId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/suggestions/$suggestionId/dismiss')({
  server: {
    handlers: {
      /**
       * POST /api/v1/suggestions/:suggestionId/dismiss
       * Dismiss an AI-generated suggestion
       */
      POST: async ({ request, params }) => {
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult
        const { principalId } = authResult

        try {
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

          if (isTypeId(suggestionId, 'merge_sug')) {
            const { dismissMergeSuggestion } =
              await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
            await dismissMergeSuggestion(suggestionId as MergeSuggestionId, principalId)
            return successResponse({ dismissed: true, id: suggestionId })
          }

          const { dismissSuggestion } =
            await import('@/lib/server/domains/feedback/pipeline/suggestion.service')
          await dismissSuggestion(suggestionId as FeedbackSuggestionId, principalId)
          return successResponse({ dismissed: true, id: suggestionId })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
