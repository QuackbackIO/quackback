import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
import { listChangelogs, createChangelog } from '@/lib/server/domains/changelog'
import type { PublishState } from '@/lib/server/domains/changelog'
import { db, principal, eq } from '@/lib/server/db'

// Input validation schema
const createChangelogSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  content: z.string().min(1, 'Content is required'),
  publishedAt: z.string().datetime().optional(),
})

export const Route = createFileRoute('/api/v1/changelog/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/changelog
       * List all changelog entries
       */
      GET: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request, { role: 'team' })
        if (authResult instanceof Response) return authResult

        try {
          // Parse query params
          const url = new URL(request.url)
          const published = url.searchParams.get('published')
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)

          // Map published filter to service status param
          let status: 'draft' | 'published' | 'all' = 'all'
          if (published === 'true') {
            status = 'published'
          } else if (published === 'false') {
            status = 'draft'
          }

          const result = await listChangelogs({ status, cursor, limit })

          return successResponse(
            result.items.map((entry) => ({
              id: entry.id,
              title: entry.title,
              content: entry.content,
              publishedAt: entry.publishedAt?.toISOString() || null,
              createdAt: entry.createdAt.toISOString(),
              updatedAt: entry.updatedAt.toISOString(),
            })),
            {
              pagination: {
                cursor: result.nextCursor,
                hasMore: result.hasMore,
              },
            }
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/changelog
       * Create a new changelog entry
       */
      POST: async ({ request }) => {
        // Authenticate (admin only)
        const authResult = await withApiKeyAuth(request, { role: 'admin' })
        if (authResult instanceof Response) return authResult

        try {
          // Parse and validate body
          const body = await request.json()
          const parsed = createChangelogSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Determine publish state from publishedAt
          let publishState: PublishState
          if (parsed.data.publishedAt) {
            const publishDate = new Date(parsed.data.publishedAt)
            if (publishDate > new Date()) {
              publishState = { type: 'scheduled', publishAt: publishDate }
            } else {
              publishState = { type: 'published' }
            }
          } else {
            publishState = { type: 'draft' }
          }

          // Look up principal display name for author info
          const principalRecord = await db.query.principal.findFirst({
            where: eq(principal.id, authResult.principalId),
            columns: { displayName: true },
          })
          const authorName = principalRecord?.displayName ?? 'API'

          const entry = await createChangelog(
            {
              title: parsed.data.title,
              content: parsed.data.content,
              publishState,
            },
            {
              principalId: authResult.principalId,
              name: authorName,
            }
          )

          return createdResponse({
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
    },
  },
})
