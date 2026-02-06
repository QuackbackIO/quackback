import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'

// Input validation schema
const createTagSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color')
    .optional()
    .default('#6b7280'),
})

export const Route = createFileRoute('/api/v1/tags/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/tags
       * List all tags
       */
      GET: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          // Import service function
          const { listTags } = await import('@/lib/server/domains/tags/tag.service')

          const tags = await listTags()

          return successResponse(
            tags.map((tag) => ({
              id: tag.id,
              name: tag.name,
              color: tag.color,
              createdAt: tag.createdAt.toISOString(),
            }))
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/tags
       * Create a new tag
       */
      POST: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          // Parse and validate body
          const body = await request.json()
          const parsed = createTagSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { createTag } = await import('@/lib/server/domains/tags/tag.service')

          const tag = await createTag({
            name: parsed.data.name,
            color: parsed.data.color,
          })

          return createdResponse({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            createdAt: tag.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
