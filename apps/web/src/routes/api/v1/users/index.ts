import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  handleDomainError,
  decodeCursor,
  encodeCursor,
} from '@/lib/server/domains/api/responses'

export const Route = createFileRoute('/api/v1/users/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/users
       * List all portal users (role='user')
       */
      GET: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          // Parse query params
          const url = new URL(request.url)
          const search = url.searchParams.get('search') || undefined
          const verified = url.searchParams.get('verified')
          const dateFrom = url.searchParams.get('dateFrom')
          const dateTo = url.searchParams.get('dateTo')
          const sort = url.searchParams.get('sort') as
            | 'newest'
            | 'oldest'
            | 'most_active'
            | 'name'
            | undefined
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
          const offset = decodeCursor(cursor)
          const page = Math.floor(offset / limit) + 1

          // Import service function
          const { listPortalUsers } = await import('@/lib/server/domains/users/user.service')

          const result = await listPortalUsers({
            search,
            verified: verified === 'true' ? true : verified === 'false' ? false : undefined,
            dateFrom: dateFrom ? new Date(dateFrom) : undefined,
            dateTo: dateTo ? new Date(dateTo) : undefined,
            sort: sort || 'newest',
            page,
            limit,
          })

          // Calculate next cursor
          const nextOffset = offset + result.items.length
          const nextCursor = result.hasMore ? encodeCursor(nextOffset) : null

          return successResponse(
            result.items.map((user) => ({
              principalId: user.principalId,
              userId: user.userId,
              name: user.name,
              email: user.email,
              image: user.image,
              emailVerified: user.emailVerified,
              joinedAt: user.joinedAt.toISOString(),
              postCount: user.postCount,
              commentCount: user.commentCount,
              voteCount: user.voteCount,
            })),
            {
              pagination: {
                cursor: nextCursor,
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
