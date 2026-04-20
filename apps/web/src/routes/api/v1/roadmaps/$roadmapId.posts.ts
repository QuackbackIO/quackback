import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { RoadmapId, PostId, StatusId } from '@quackback/ids'

// Input validation schema
const addPostSchema = z.object({
  postId: z.string().min(1, 'Post ID is required'),
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
          await withApiKeyAuth(request, { role: 'team' })

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const url = new URL(request.url)
          const statusId = url.searchParams.get('statusId') as StatusId | null
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
          const offset = parseInt(url.searchParams.get('offset') || '0', 10)

          const { getRoadmapPosts } = await import('@/lib/server/domains/roadmaps/roadmap.query')

          const result = await getRoadmapPosts(roadmapId, {
            statusId: statusId || undefined,
            limit,
            offset,
          })

          return successResponse({
            items: result.items.map((item) => ({
              id: item.id,
              title: item.title,
              voteCount: item.voteCount,
              statusId: item.statusId,
              board: {
                id: item.board.id,
                name: item.board.name,
                slug: item.board.slug,
              },
              position: item.roadmapEntry.position,
            })),
            total: result.total,
            hasMore: result.hasMore,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/roadmaps/:roadmapId/posts
       * Add a post to a roadmap
       */
      POST: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const body = await request.json()
          const parsed = addPostSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const postId = parseTypeId<PostId>(parsed.data.postId, 'post', 'post ID')

          const { addPostToRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          await addPostToRoadmap({ roadmapId, postId })

          return createdResponse({
            message: 'Post added to roadmap',
            roadmapId,
            postId,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
