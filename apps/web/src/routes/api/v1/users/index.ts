import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  handleDomainError,
  decodeCursor,
  encodeCursor,
  parsePaginationParams,
} from '@/lib/server/domains/api/responses'
import { parseTypeIdArray } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { SegmentId } from '@quackback/ids'

export const Route = createFileRoute('/api/v1/users/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/users
       * List all portal users (role='user')
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.PEOPLE_VIEW })

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
          const segmentIds = parseTypeIdArray<SegmentId>(
            segmentIdsParam ? segmentIdsParam.split(',').filter(Boolean) : undefined,
            'segment',
            'segment IDs'
          )
          // The cursor is a row offset, so a caller may change the limit between pages.
          const { cursor, limit } = parsePaginationParams(url)
          const offset = decodeCursor(cursor)

          // Import service functions
          const { listPortalUsers } = await import('@/lib/server/domains/users/user.service')
          const { parseUserAttributes } = await import('@/lib/server/domains/users/user.attributes')

          const result = await listPortalUsers({
            search,
            verified: verifiedBool,
            dateFrom: dateFrom ? new Date(dateFrom) : undefined,
            dateTo: dateTo ? new Date(dateTo) : undefined,
            sort: sort || 'newest',
            segmentIds,
            offset,
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
