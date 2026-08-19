import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  roadmapBaseFilterSchema,
  roadmapFrequencySchema,
  roadmapTypeSchema,
  roadmapVisibilitySchema,
  segmentIdInputSchema,
} from '@/lib/shared/roadmap-config'
import { postStatusIdSchema, roadmapColumnIdSchema } from '@quackback/ids/zod'

const roadmapColumnSchema = z.object({
  id: roadmapColumnIdSchema.optional(),
  statusId: postStatusIdSchema,
  name: z.string().min(1).max(100),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().min(1).max(50),
  position: z.number().int().min(0),
})

// Input validation schema
const createRoadmapSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens'),
  description: z.string().max(500).optional(),
  type: roadmapTypeSchema.optional(),
  baseFilter: roadmapBaseFilterSchema.optional(),
  dateSource: z.literal('eta').nullable().optional(),
  frequency: roadmapFrequencySchema.nullable().optional(),
  visibility: roadmapVisibilitySchema.optional(),
  visibleSegmentIds: z.array(segmentIdInputSchema).nullable().optional(),
  columns: z.array(roadmapColumnSchema).optional(),
})

function serializeRoadmap(
  roadmap: Awaited<
    ReturnType<(typeof import('@/lib/server/domains/roadmaps/roadmap.service'))['getRoadmap']>
  >
) {
  return {
    id: roadmap.id,
    name: roadmap.name,
    slug: roadmap.slug,
    description: roadmap.description,
    type: roadmap.type,
    baseFilter: roadmap.baseFilter,
    dateSource: roadmap.dateSource,
    frequency: roadmap.frequency,
    visibility: roadmap.visibility,
    visibleSegmentIds: roadmap.visibleSegmentIds,
    position: roadmap.position,
    columns: roadmap.columns,
    createdAt: roadmap.createdAt.toISOString(),
  }
}

export const Route = createFileRoute('/api/v1/roadmaps/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/roadmaps
       * List all roadmaps
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request)

          // Import service function
          const { listRoadmaps } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          const roadmaps = await listRoadmaps()

          return successResponse(roadmaps.map(serializeRoadmap))
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
          await withApiKeyAuth(request, { permission: PERMISSIONS.ROADMAP_MANAGE })

          // Parse and validate body
          const body = await request.json()
          const parsed = createRoadmapSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { createRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          const roadmap = await createRoadmap(parsed.data as Parameters<typeof createRoadmap>[0])

          return createdResponse(serializeRoadmap(roadmap))
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
