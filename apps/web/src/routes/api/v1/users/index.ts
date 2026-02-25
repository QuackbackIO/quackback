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
          let verifiedBool: boolean | undefined
          if (verified === 'true') verifiedBool = true
          else if (verified === 'false') verifiedBool = false

          const dateFrom = url.searchParams.get('dateFrom')
          const dateTo = url.searchParams.get('dateTo')
          const sort = url.searchParams.get('sort') as
            | 'newest'
            | 'oldest'
            | 'most_active'
            | 'most_posts'
            | 'most_comments'
            | 'most_votes'
            | 'name'
            | undefined
          const segmentIdsParam = url.searchParams.get('segmentIds')
          const segmentIds = segmentIdsParam
            ? (segmentIdsParam.split(',').filter(Boolean) as import('@quackback/ids').SegmentId[])
            : undefined
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
          const offset = decodeCursor(cursor)
          const page = Math.floor(offset / limit) + 1

          // Import service functions
          const { listPortalUsers, parseUserAttributes } =
            await import('@/lib/server/domains/users/user.service')

          const result = await listPortalUsers({
            search,
            verified: verifiedBool,
            dateFrom: dateFrom ? new Date(dateFrom) : undefined,
            dateTo: dateTo ? new Date(dateTo) : undefined,
            sort: sort || 'newest',
            segmentIds,
            page,
            limit,
          })

          // Calculate next cursor
          const nextOffset = offset + result.items.length
          const nextCursor = result.hasMore ? encodeCursor(nextOffset) : null

          return successResponse(
            result.items.map((u) => ({
              principalId: u.principalId,
              userId: u.userId,
              name: u.name,
              email: u.email,
              image: u.image,
              emailVerified: u.emailVerified,
              attributes: parseUserAttributes(u.metadata),
              joinedAt: u.joinedAt.toISOString(),
              postCount: u.postCount,
              commentCount: u.commentCount,
              voteCount: u.voteCount,
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
