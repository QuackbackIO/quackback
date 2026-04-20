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
import type { TagId } from '@quackback/ids'

// Input validation schema
const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color')
    .optional(),
  description: z.string().max(200).optional().nullable(),
})

export const Route = createFileRoute('/api/v1/tags/$tagId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/tags/:tagId
       * Get a single tag by ID
       */
      GET: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const tagId = parseTypeId<TagId>(params.tagId, 'tag', 'tag ID')

          const { getTagById } = await import('@/lib/server/domains/tags/tag.service')

          const tag = await getTagById(tagId)

          return successResponse({
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

      /**
       * PATCH /api/v1/tags/:tagId
       * Update a tag
       */
      PATCH: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const tagId = parseTypeId<TagId>(params.tagId, 'tag', 'tag ID')

          const body = await request.json()
          const parsed = updateTagSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          const { updateTag } = await import('@/lib/server/domains/tags/tag.service')

          const tag = await updateTag(tagId, {
            name: parsed.data.name,
            color: parsed.data.color,
            description: parsed.data.description,
          })

          return successResponse({
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

      /**
       * DELETE /api/v1/tags/:tagId
       * Delete a tag
       */
      DELETE: async ({ request, params }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          const tagId = parseTypeId<TagId>(params.tagId, 'tag', 'tag ID')

          const { deleteTag } = await import('@/lib/server/domains/tags/tag.service')

          await deleteTag(tagId)

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
