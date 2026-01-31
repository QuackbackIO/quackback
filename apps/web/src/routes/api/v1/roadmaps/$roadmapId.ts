import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/api/responses'
import { validateTypeId } from '@/lib/api/validation'
import type { RoadmapId } from '@quackback/ids'

// Input validation schema
const updateRoadmapSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/roadmaps/$roadmapId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/roadmaps/:roadmapId
       * Get a single roadmap by ID
       */
      GET: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { roadmapId } = params

          // Validate TypeID format
          const validationError = validateTypeId(roadmapId, 'roadmap', 'roadmap ID')
          if (validationError) return validationError

          // Import service function
          const { getRoadmap } = await import('@/lib/roadmaps/roadmap.service')

          const roadmap = await getRoadmap(roadmapId as RoadmapId)

          return successResponse({
            id: roadmap.id,
            name: roadmap.name,
            slug: roadmap.slug,
            description: roadmap.description,
            isPublic: roadmap.isPublic,
            position: roadmap.position,
            createdAt: roadmap.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/roadmaps/:roadmapId
       * Update a roadmap
       */
      PATCH: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { roadmapId } = params

          // Validate TypeID format
          const validationError = validateTypeId(roadmapId, 'roadmap', 'roadmap ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = updateRoadmapSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { updateRoadmap } = await import('@/lib/roadmaps/roadmap.service')

          const roadmap = await updateRoadmap(roadmapId as RoadmapId, {
            name: parsed.data.name,
            description: parsed.data.description,
            isPublic: parsed.data.isPublic,
          })

          return successResponse({
            id: roadmap.id,
            name: roadmap.name,
            slug: roadmap.slug,
            description: roadmap.description,
            isPublic: roadmap.isPublic,
            position: roadmap.position,
            createdAt: roadmap.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/roadmaps/:roadmapId
       * Delete a roadmap
       */
      DELETE: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { roadmapId } = params

          // Validate TypeID format
          const validationError = validateTypeId(roadmapId, 'roadmap', 'roadmap ID')
          if (validationError) return validationError

          // Import service function
          const { deleteRoadmap } = await import('@/lib/roadmaps/roadmap.service')

          await deleteRoadmap(roadmapId as RoadmapId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
