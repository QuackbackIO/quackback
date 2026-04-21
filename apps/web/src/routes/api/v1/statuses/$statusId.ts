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
import type { StatusId } from '@quackback/ids'

// Input validation schema - matches UpdateStatusInput from service
const updateStatusSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color')
    .optional(),
  showOnRoadmap: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

export const Route = createFileRoute('/api/v1/statuses/$statusId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/statuses/:statusId
       * Get a single status by ID
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const statusId = parseTypeId<StatusId>(params.statusId, 'status', 'status ID')

          const { getStatusById } = await import('@/lib/server/domains/statuses/status.service')

          const status = await getStatusById(statusId)

          return successResponse({
            id: status.id,
            name: status.name,
            slug: status.slug,
            color: status.color,
            category: status.category,
            position: status.position,
            showOnRoadmap: status.showOnRoadmap,
            isDefault: status.isDefault,
            createdAt: status.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/statuses/:statusId
       * Update a status
       */
      PATCH: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const statusId = parseTypeId<StatusId>(params.statusId, 'status', 'status ID')

          const body = await request.json()
          const parsed = updateStatusSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { updateStatus } = await import('@/lib/server/domains/statuses/status.service')

          const status = await updateStatus(statusId, {
            name: parsed.data.name,
            color: parsed.data.color,
            showOnRoadmap: parsed.data.showOnRoadmap,
            isDefault: parsed.data.isDefault,
          })

          return successResponse({
            id: status.id,
            name: status.name,
            slug: status.slug,
            color: status.color,
            category: status.category,
            position: status.position,
            showOnRoadmap: status.showOnRoadmap,
            isDefault: status.isDefault,
            createdAt: status.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/statuses/:statusId
       * Delete a status
       */
      DELETE: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const statusId = parseTypeId<StatusId>(params.statusId, 'status', 'status ID')

          const { deleteStatus } = await import('@/lib/server/domains/statuses/status.service')

          await deleteStatus(statusId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
