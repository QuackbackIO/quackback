import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import type { RoadmapColumnId, RoadmapId } from '@quackback/ids'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  badRequestResponse,
  handleDomainError,
  noContentResponse,
  successResponse,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'

const updateColumnSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().min(1).max(50).optional(),
  position: z.number().int().min(0).optional(),
})

export const Route = createFileRoute('/api/v1/roadmaps/$roadmapId/columns/$columnId')({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.ROADMAP_MANAGE })
          parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')
          const columnId = parseTypeId<RoadmapColumnId>(
            params.columnId,
            'roadmap_col',
            'roadmap column ID'
          )
          const parsed = updateColumnSchema.safeParse(await request.json())
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { updateRoadmapColumn } =
            await import('@/lib/server/domains/roadmaps/roadmap.service')
          return successResponse(await updateRoadmapColumn(columnId, parsed.data))
        } catch (error) {
          return handleDomainError(error)
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.ROADMAP_MANAGE })
          parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')
          const columnId = parseTypeId<RoadmapColumnId>(
            params.columnId,
            'roadmap_col',
            'roadmap column ID'
          )
          const { deleteRoadmapColumn } =
            await import('@/lib/server/domains/roadmaps/roadmap.service')
          await deleteRoadmapColumn(columnId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
