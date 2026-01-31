import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/api/responses'

// Input validation schema
const createStatusSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Slug must be lowercase with underscores only'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color'),
  category: z.enum(['active', 'complete', 'closed']),
  position: z.number().int().min(0).optional(),
  showOnRoadmap: z.boolean().optional().default(false),
  isDefault: z.boolean().optional().default(false),
})

export const Route = createFileRoute('/api/v1/statuses/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/statuses
       * List all statuses
       */
      GET: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          // Import service function
          const { listStatuses } = await import('@/lib/statuses/status.service')

          const statuses = await listStatuses()

          return successResponse(
            statuses.map((status) => ({
              id: status.id,
              name: status.name,
              slug: status.slug,
              color: status.color,
              category: status.category,
              position: status.position,
              showOnRoadmap: status.showOnRoadmap,
              isDefault: status.isDefault,
              createdAt: status.createdAt.toISOString(),
            }))
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/statuses
       * Create a new status
       */
      POST: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          // Parse and validate body
          const body = await request.json()
          const parsed = createStatusSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { createStatus } = await import('@/lib/statuses/status.service')

          const status = await createStatus({
            name: parsed.data.name,
            slug: parsed.data.slug,
            color: parsed.data.color,
            category: parsed.data.category,
            position: parsed.data.position,
            showOnRoadmap: parsed.data.showOnRoadmap,
            isDefault: parsed.data.isDefault,
          })

          return createdResponse({
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
    },
  },
})
