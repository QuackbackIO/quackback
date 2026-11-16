import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { isValidTypeId } from '@quackback/ids'
import type { PostId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'

export const Route = createFileRoute('/api/v1/suggestions/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/suggestions
       * List pending post-to-post merge suggestions.
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.SUGGESTION_VIEW })

          const url = new URL(request.url)
          const sortParam = url.searchParams.get('sort') ?? undefined
          if (sortParam !== undefined && sortParam !== 'newest' && sortParam !== 'relevance') {
            return badRequestResponse('Invalid sort parameter. Expected newest or relevance')
          }

          const postIdParam = url.searchParams.get('postId') ?? undefined
          if (postIdParam !== undefined && !isValidTypeId(postIdParam, 'post')) {
            return badRequestResponse('Invalid postId format. Expected post_xxx')
          }

          const rawLimit = url.searchParams.get('limit')
          const parsedLimit = rawLimit !== null ? parseInt(rawLimit, 10) : 50
          if (rawLimit !== null && (!Number.isFinite(parsedLimit) || parsedLimit < 1)) {
            return badRequestResponse('Invalid limit parameter. Expected a positive integer')
          }
          const limit = Math.min(100, Math.max(1, parsedLimit))

          const { getPendingMergeSuggestions } =
            await import('@/lib/server/domains/merge-suggestions/merge-suggestion.service')
          const result = await getPendingMergeSuggestions({
            sort: sortParam,
            limit,
            postId: postIdParam as PostId | undefined,
          })

          return successResponse(
            result.items.map((item) => ({
              id: item.id,
              status: item.status,
              hybridScore: item.hybridScore,
              llmConfidence: item.llmConfidence,
              llmReasoning: item.llmReasoning,
              createdAt: item.createdAt.toISOString(),
              updatedAt: item.updatedAt.toISOString(),
              sourcePost: {
                ...item.sourcePost,
                createdAt: item.sourcePost.createdAt.toISOString(),
              },
              targetPost: {
                ...item.targetPost,
                createdAt: item.targetPost.createdAt.toISOString(),
              },
            })),
            {
              pagination: {
                cursor: null,
                hasMore: result.total > result.items.length,
                total: result.total,
              },
            }
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
