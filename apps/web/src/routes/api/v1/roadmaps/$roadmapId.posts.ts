import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
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
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { roadmapId } = params

          // Validate TypeID format
          const validationError = validateTypeId(roadmapId, 'roadmap', 'roadmap ID')
          if (validationError) return validationError

          // Parse query params
          const url = new URL(request.url)
          const statusId = url.searchParams.get('statusId') as StatusId | null
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
          const offset = parseInt(url.searchParams.get('offset') || '0', 10)

          // Import service function
          const { getRoadmapPosts } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          const result = await getRoadmapPosts(roadmapId as RoadmapId, {
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
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { roadmapId } = params

          // Validate TypeID format
          const validationError = validateTypeId(roadmapId, 'roadmap', 'roadmap ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = addPostSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Validate TypeID format in request body
          const bodyValidationError = validateTypeId(parsed.data.postId, 'post', 'post ID')
          if (bodyValidationError) return bodyValidationError

          // Import service function
          const { addPostToRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          await addPostToRoadmap({
            roadmapId: roadmapId as RoadmapId,
            postId: parsed.data.postId as PostId,
          })

          return createdResponse({
            message: 'Post added to roadmap',
            roadmapId,
            postId: parsed.data.postId,
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
