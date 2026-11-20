import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  badRequestResponse,
  successResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { RoadmapId, PostStatusId } from '@quackback/ids'
import { toIsoStringOrNull } from '@/lib/shared/utils'

const pagingSchema = z.object({
  limit: z.coerce.number().int().min(1).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

export const Route = createFileRoute('/api/v1/roadmaps/$roadmapId/posts')({
  server: {
    handlers: {
      /**
       * GET /api/v1/roadmaps/:roadmapId/posts
       * List posts in a roadmap
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.POST_VIEW_PRIVATE })

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const url = new URL(request.url)
          const rawStatusId = url.searchParams.get('statusId')
          const statusId = rawStatusId
            ? parseTypeId<PostStatusId>(rawStatusId, 'post_status', 'status ID')
            : undefined
          const bucketId = url.searchParams.get('bucketId') ?? undefined
          const paging = pagingSchema.safeParse({
            limit: url.searchParams.get('limit') || undefined,
            offset: url.searchParams.get('offset') || undefined,
          })
          if (!paging.success) {
            return badRequestResponse('Invalid paging', {
              errors: paging.error.flatten().fieldErrors,
            })
          }
          const limit = Math.min(paging.data.limit, 100)
          const { offset } = paging.data

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
