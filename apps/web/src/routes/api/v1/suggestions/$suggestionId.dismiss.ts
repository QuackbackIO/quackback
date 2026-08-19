import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { isValidTypeId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PostMergeSuggestionId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/suggestions/$suggestionId/dismiss')({
  server: {
    handlers: {
      /**
       * POST /api/v1/suggestions/:suggestionId/dismiss
       * Dismiss a post-to-post merge suggestion.
       */
      POST: async ({ request, params }) => {
        try {
          const { principalId } = await withApiKeyAuth(request, {
            permission: PERMISSIONS.SUGGESTION_MANAGE,
          })
          const { suggestionId } = params

          if (!isValidTypeId(suggestionId, 'post_merge_sug')) {
            return badRequestResponse('Invalid suggestion ID format. Expected post_merge_sug_xxx')
          }

          const { dismissMergeSuggestion } =
            await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
          await dismissMergeSuggestion(suggestionId as PostMergeSuggestionId, principalId)
          return successResponse({ dismissed: true, id: suggestionId })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
