import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { roadmapAccessSchema } from '@/lib/shared/schemas/roadmaps'

// Input validation schema. `isPublic` is the legacy boolean (kept for backward
// compatibility); `access` is the richer tier+segments control. When both are
// present, `access` wins.
const createRoadmapSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional(),
  access: roadmapAccessSchema.optional(),
})

export const Route = createFileRoute('/api/v1/roadmaps/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/roadmaps
       * List all roadmaps
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          // Import service function
          const { listRoadmaps, roadmapAccessToIsPublic } =
            await import('@/lib/server/domains/roadmaps/roadmap.service')

          const roadmaps = await listRoadmaps()

          return successResponse(
            roadmaps.map((roadmap) => ({
              id: roadmap.id,
              name: roadmap.name,
              slug: roadmap.slug,
              description: roadmap.description,
              isPublic: roadmapAccessToIsPublic(roadmap.access),
              access: roadmap.access,
              position: roadmap.position,
              createdAt: roadmap.createdAt.toISOString(),
            }))
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/roadmaps
       * Create a new roadmap
       */
      POST: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          // Parse and validate body
          const body = await request.json()
          const parsed = createRoadmapSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { createRoadmap, roadmapAccessToIsPublic, isPublicToRoadmapAccess } =
            await import('@/lib/server/domains/roadmaps/roadmap.service')

          // `access` takes precedence; otherwise map the legacy `isPublic`
          // (defaulting to public when neither is supplied).
          const access = parsed.data.access ?? isPublicToRoadmapAccess(parsed.data.isPublic ?? true)

          const roadmap = await createRoadmap({
            name: parsed.data.name,
            slug: parsed.data.slug,
            description: parsed.data.description,
            access,
          })

          return createdResponse({
            id: roadmap.id,
            name: roadmap.name,
            slug: roadmap.slug,
            description: roadmap.description,
            isPublic: roadmapAccessToIsPublic(roadmap.access),
            access: roadmap.access,
            position: roadmap.position,
            createdAt: roadmap.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
