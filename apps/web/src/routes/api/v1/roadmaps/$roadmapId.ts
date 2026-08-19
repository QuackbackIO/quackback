import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import type { RoadmapId } from '@quackback/ids'
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
const updateRoadmapSchema = z.object({
  name: z.string().min(1).max(100).optional(),
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

export const Route = createFileRoute('/api/v1/roadmaps/$roadmapId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/roadmaps/:roadmapId
       * Get a single roadmap by ID
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request)

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const { getRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          const roadmap = await getRoadmap(roadmapId)

          return successResponse(serializeRoadmap(roadmap))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/roadmaps/:roadmapId
       * Update a roadmap
       */
      PATCH: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.ROADMAP_MANAGE })

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const body = await request.json()
          const parsed = updateRoadmapSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { updateRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          const roadmap = await updateRoadmap(
            roadmapId,
            parsed.data as Parameters<typeof updateRoadmap>[1]
          )

          return successResponse(serializeRoadmap(roadmap))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/roadmaps/:roadmapId
       * Delete a roadmap
       */
      DELETE: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.ROADMAP_MANAGE })

          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')

          const { deleteRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')

          await deleteRoadmap(roadmapId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
