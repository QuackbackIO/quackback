import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { encodeCursor, decodeCursor } from '@/lib/server/domains/api/responses'

export const Route = createFileRoute('/api/v1/suggestions/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/suggestions
       * List AI-generated feedback suggestions with filtering and pagination
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })
          const url = new URL(request.url)

          // Parse query params
          const status = (url.searchParams.get('status') as 'pending' | 'dismissed') ?? 'pending'
          const suggestionType = url.searchParams.get('type') as
            | 'create_post'
            | 'vote_on_post'
            | 'duplicate_post'
            | null
          const sort = (url.searchParams.get('sort') as 'newest' | 'relevance') ?? 'newest'
          const limit = Math.min(
            100,
            Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
          )
          const cursor = url.searchParams.get('cursor') ?? undefined

          const { listSuggestions } = await import('@/lib/server/domains/feedback/suggestion.query')

          const offset = decodeCursor(cursor)

          const result = await listSuggestions({
            status,
            suggestionType: suggestionType || undefined,
            sort,
            limit,
            offset,
          })

          return successResponse(
            result.items.map((item) => ({
              id: item.id,
              suggestionType: item.suggestionType,
              status: item.status,
              suggestedTitle: item.suggestedTitle,
              suggestedBody: item.suggestedBody,
              reasoning: item.reasoning,
              similarityScore: item.similarityScore,
              rawItem: item.rawItem
                ? {
                    id: item.rawItem.id,
                    sourceType: item.rawItem.sourceType,
                    externalUrl: item.rawItem.externalUrl,
                    author: item.rawItem.author,
                  }
                : null,
              targetPost: item.targetPost,
              sourcePost: item.sourcePost,
              board: item.board,
              signal: item.signal,
              createdAt:
                item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
              updatedAt:
                item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
            })),
            {
              pagination: {
                cursor: result.hasMore ? encodeCursor(offset + limit) : null,
                hasMore: result.hasMore,
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
