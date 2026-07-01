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

// Input validation schema
const createTagSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color')
    .optional()
    .default('#6b7280'),
  description: z.string().max(200).optional(),
})

export const Route = createFileRoute('/api/v1/tags/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/tags
       * List all tags
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request)

          // Import service function
          const { listPostTags } = await import('@/lib/server/domains/post-tags/post-tag.service')

          const tags = await listPostTags()

          return successResponse(
            tags.map((tag) => ({
              id: tag.id,
              name: tag.name,
              color: tag.color,
              description: tag.description,
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
        try {
          await withApiKeyAuth(request, { permission: PERMISSIONS.TAG_MANAGE })

          // Parse and validate body
          const body = await request.json()
          const parsed = createTagSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { createPostTag } = await import('@/lib/server/domains/post-tags/post-tag.service')

          const tag = await createPostTag({
            name: parsed.data.name,
            color: parsed.data.color,
            description: parsed.data.description,
          })

          return createdResponse({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            description: tag.description,
            createdAt: tag.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
