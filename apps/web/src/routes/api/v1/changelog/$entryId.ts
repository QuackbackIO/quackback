import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  noContentResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { validateTypeId } from '@/lib/server/domains/api/validation'
import {
  getChangelogById,
  updateChangelog,
  deleteChangelog,
} from '@/lib/server/domains/changelog/changelog.service'
import type { PublishState } from '@/lib/shared/schemas/changelog'
import type { ChangelogId } from '@quackback/ids'

// Input validation schema
const updateChangelogSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  publishedAt: z.string().datetime().nullable().optional(),
})

function formatChangelogResponse(entry: {
  id: string
  title: string
  content: string
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    publishedAt: entry.publishedAt?.toISOString() || null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  }
}

export const Route = createFileRoute('/api/v1/changelog/$entryId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/changelog/:entryId
       * Get a single changelog entry by ID
       */
      GET: async ({ request, params }) => {
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { entryId } = params

          const validationError = validateTypeId(entryId, 'changelog', 'changelog entry ID')
          if (validationError) return validationError

          const entry = await getChangelogById(entryId as ChangelogId)
          return successResponse(formatChangelogResponse(entry))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/changelog/:entryId
       * Update a changelog entry
       */
      PATCH: async ({ request, params }) => {
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { entryId } = params

          const validationError = validateTypeId(entryId, 'changelog', 'changelog entry ID')
          if (validationError) return validationError

          const body = await request.json()
          const parsed = updateChangelogSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Convert publishedAt to PublishState, preserving exact timestamps
          let publishState: PublishState | undefined
          if (parsed.data.publishedAt !== undefined) {
            if (parsed.data.publishedAt === null) {
              publishState = { type: 'draft' }
            } else {
              const publishDate = new Date(parsed.data.publishedAt)
              publishState =
                publishDate > new Date()
                  ? { type: 'scheduled', publishAt: publishDate }
                  : { type: 'published', publishAt: publishDate }
            }
          }

          const updated = await updateChangelog(entryId as ChangelogId, {
            title: parsed.data.title,
            content: parsed.data.content,
            ...(publishState && { publishState }),
          })

          return successResponse(formatChangelogResponse(updated))
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/changelog/:entryId
       * Delete a changelog entry
       */
      DELETE: async ({ request, params }) => {
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { entryId } = params

          const validationError = validateTypeId(entryId, 'changelog', 'changelog entry ID')
          if (validationError) return validationError

          await deleteChangelog(entryId as ChangelogId)
          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
