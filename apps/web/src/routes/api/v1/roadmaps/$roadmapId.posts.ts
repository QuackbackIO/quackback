import { createFileRoute } from '@tanstack/react-router'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { successResponse, handleDomainError } from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { RoadmapId, PostStatusId } from '@quackback/ids'
import { toIsoStringOrNull } from '@/lib/shared/utils'

export const Route = createFileRoute('/api/v1/roadmaps/$roadmapId/posts')({
  server: {
    handlers: {
      /**
       * GET /api/v1/roadmaps/:roadmapId/posts
       * List posts in a roadmap
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request)

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const url = new URL(request.url)
          const rawStatusId = url.searchParams.get('statusId')
          const statusId = rawStatusId
            ? parseTypeId<PostStatusId>(rawStatusId, 'post_status', 'status ID')
            : undefined
          const bucketId = url.searchParams.get('bucketId') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
          const offset = parseInt(url.searchParams.get('offset') || '0', 10)

          const { getRoadmapPosts } = await import('@/lib/server/domains/roadmaps/roadmap.query')

          const result = await getRoadmapPosts(roadmapId, {
            statusId,
            bucketId,
            limit,
            offset,
          })

          return successResponse({
            items: result.items.map((item) => ({
              id: item.id,
              title: item.title,
              voteCount: item.voteCount,
              statusId: item.statusId,
              eta: toIsoStringOrNull(item.eta),
              board: {
                id: item.board.id,
                name: item.board.name,
                slug: item.board.slug,
              },
            })),
            total: result.total,
            hasMore: result.hasMore,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
