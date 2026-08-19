import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import type { PostStatusId, RoadmapId } from '@quackback/ids'
import { postStatusIdSchema } from '@quackback/ids/zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  badRequestResponse,
  createdResponse,
  handleDomainError,
  successResponse,
} from '@/lib/server/domains/api/responses'
import { parseTypeId } from '@/lib/server/domains/api/validation'
import { PERMISSIONS } from '@/lib/shared/permissions'

const createColumnSchema = z.object({
  statusId: postStatusIdSchema,
  name: z.string().min(1).max(100),
  icon: z.string().max(50).nullable().optional(),
  color: z.string().min(1).max(50),
  position: z.number().int().min(0).optional(),
})

export const Route = createFileRoute('/api/v1/roadmaps/$roadmapId/columns')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request)
          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')
          const { getRoadmap } = await import('@/lib/server/domains/roadmaps/roadmap.service')
          return successResponse((await getRoadmap(roadmapId)).columns)
        } catch (error) {
          return handleDomainError(error)
        }
      },
      POST: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.ROADMAP_MANAGE })
          const roadmapId = parseTypeId<RoadmapId>(params.roadmapId, 'roadmap', 'roadmap ID')
          const parsed = createColumnSchema.safeParse(await request.json())
          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }
          const { createRoadmapColumn } =
            await import('@/lib/server/domains/roadmaps/roadmap.service')
          return createdResponse(
            await createRoadmapColumn({
              ...parsed.data,
              roadmapId,
              statusId: parsed.data.statusId as PostStatusId,
            })
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
