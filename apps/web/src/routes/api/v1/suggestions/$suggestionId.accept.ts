import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { isValidTypeId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PostMergeSuggestionId } from '@quackback/ids'
import { readJsonBody } from '@/lib/server/domains/api/request'

const acceptSchema = z.object({ swapDirection: z.boolean().optional() })

export const Route = createFileRoute('/api/v1/suggestions/$suggestionId/accept')({
  server: {
    handlers: {
      /**
       * POST /api/v1/suggestions/:suggestionId/accept
       * Accept a post-to-post merge suggestion.
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

          // The body is optional
          const parsed = acceptSchema.safeParse((await readJsonBody(request)) ?? {})
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { acceptMergeSuggestion } =
            await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
          await acceptMergeSuggestion(suggestionId as PostMergeSuggestionId, principalId, {
            swapDirection: parsed.data.swapDirection,
          })
          return successResponse({ accepted: true, id: suggestionId })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
