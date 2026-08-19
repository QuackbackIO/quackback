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

export const Route = createFileRoute('/api/v1/suggestions/$suggestionId/restore')({
  server: {
    handlers: {
      /**
       * POST /api/v1/suggestions/:suggestionId/restore
       * Restore a dismissed merge suggestion back to pending.
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

          const { restoreMergeSuggestion } =
            await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
          await restoreMergeSuggestion(suggestionId as PostMergeSuggestionId, principalId)
          return successResponse({ restored: true, id: suggestionId })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
