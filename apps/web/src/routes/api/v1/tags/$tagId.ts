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
import type { TagId } from '@quackback/ids'

// Input validation schema
const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color')
    .optional(),
})

export const Route = createFileRoute('/api/v1/tags/$tagId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/tags/:tagId
       * Get a single tag by ID
       */
      GET: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { tagId } = params

          // Validate TypeID format
          const validationError = validateTypeId(tagId, 'tag', 'tag ID')
          if (validationError) return validationError

          // Import service function
          const { getTagById } = await import('@/lib/tags/tag.service')

          const tag = await getTagById(tagId as TagId)

          return successResponse({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            createdAt: tag.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/tags/:tagId
       * Update a tag
       */
      PATCH: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { tagId } = params

          // Validate TypeID format
          const validationError = validateTypeId(tagId, 'tag', 'tag ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = updateTagSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { updateTag } = await import('@/lib/tags/tag.service')

          const tag = await updateTag(tagId as TagId, {
            name: parsed.data.name,
            color: parsed.data.color,
          })

          return successResponse({
            id: tag.id,
            name: tag.name,
            color: tag.color,
            createdAt: tag.createdAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/tags/:tagId
       * Delete a tag
       */
      DELETE: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          const { tagId } = params

          // Validate TypeID format
          const validationError = validateTypeId(tagId, 'tag', 'tag ID')
          if (validationError) return validationError

          // Import service function
          const { deleteTag } = await import('@/lib/tags/tag.service')

          await deleteTag(tagId as TagId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
