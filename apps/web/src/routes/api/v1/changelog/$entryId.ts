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
import type { ChangelogId } from '@quackback/ids'

// Input validation schema
const updateChangelogSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  publishedAt: z.string().datetime().nullable().optional(),
})

export const Route = createFileRoute('/api/v1/changelog/$entryId')({
  server: {
    handlers: {
      /**
       * GET /api/v1/changelog/:entryId
       * Get a single changelog entry by ID
       */
      GET: async ({ request, params }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          const { entryId } = params

          // Validate TypeID format
          const validationError = validateTypeId(entryId, 'changelog', 'changelog entry ID')
          if (validationError) return validationError

          // Import db
          const { db, changelogEntries, eq } = await import('@/lib/server/db')
          const { NotFoundError } = await import('@/lib/shared/errors')

          const entry = await db.query.changelogEntries.findFirst({
            where: eq(changelogEntries.id, entryId as ChangelogId),
          })

          if (!entry) {
            throw new NotFoundError(
              'CHANGELOG_NOT_FOUND',
              `Changelog entry with ID ${entryId} not found`
            )
          }

          return successResponse({
            id: entry.id,
            title: entry.title,
            content: entry.content,
            publishedAt: entry.publishedAt?.toISOString() || null,
            createdAt: entry.createdAt.toISOString(),
            updatedAt: entry.updatedAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * PATCH /api/v1/changelog/:entryId
       * Update a changelog entry
       */
      PATCH: async ({ request, params }) => {
        // Authenticate (admin only)
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { entryId } = params

          // Validate TypeID format
          const validationError = validateTypeId(entryId, 'changelog', 'changelog entry ID')
          if (validationError) return validationError

          // Parse and validate body
          const body = await request.json()
          const parsed = updateChangelogSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import db
          const { db, changelogEntries, eq } = await import('@/lib/server/db')
          const { NotFoundError } = await import('@/lib/shared/errors')

          // Build update data
          const updateData: Record<string, unknown> = {
            updatedAt: new Date(),
          }
          if (parsed.data.title !== undefined) updateData.title = parsed.data.title
          if (parsed.data.content !== undefined) updateData.content = parsed.data.content
          if (parsed.data.publishedAt !== undefined) {
            updateData.publishedAt = parsed.data.publishedAt
              ? new Date(parsed.data.publishedAt)
              : null
          }

          // Update the entry
          const [updated] = await db
            .update(changelogEntries)
            .set(updateData)
            .where(eq(changelogEntries.id, entryId as ChangelogId))
            .returning()

          if (!updated) {
            throw new NotFoundError(
              'CHANGELOG_NOT_FOUND',
              `Changelog entry with ID ${entryId} not found`
            )
          }

          return successResponse({
            id: updated.id,
            title: updated.title,
            content: updated.content,
            publishedAt: updated.publishedAt?.toISOString() || null,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * DELETE /api/v1/changelog/:entryId
       * Delete a changelog entry
       */
      DELETE: async ({ request, params }) => {
        // Authenticate (admin only)
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          const { entryId } = params

          // Validate TypeID format
          const validationError = validateTypeId(entryId, 'changelog', 'changelog entry ID')
          if (validationError) return validationError

          // Import db
          const { db, changelogEntries, eq } = await import('@/lib/server/db')
          const { NotFoundError } = await import('@/lib/shared/errors')

          // Delete the entry
          const result = await db
            .delete(changelogEntries)
            .where(eq(changelogEntries.id, entryId as ChangelogId))
            .returning()

          if (result.length === 0) {
            throw new NotFoundError(
              'CHANGELOG_NOT_FOUND',
              `Changelog entry with ID ${entryId} not found`
            )
          }

          return noContentResponse()
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
