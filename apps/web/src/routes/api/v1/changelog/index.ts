import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
  decodeCursor,
  encodeCursor,
} from '@/lib/server/domains/api/responses'

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
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          // Parse query params
          const url = new URL(request.url)
          const published = url.searchParams.get('published')
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
          const offset = decodeCursor(cursor)

          // Import db
          const { db, changelogEntries, desc, and, isNotNull, isNull } =
            await import('@/lib/server/db')

          // Build conditions
          const conditions = []
          if (published === 'true') {
            conditions.push(isNotNull(changelogEntries.publishedAt))
          } else if (published === 'false') {
            conditions.push(isNull(changelogEntries.publishedAt))
          }

          const whereClause = conditions.length > 0 ? and(...conditions) : undefined

          // Query entries
          const entries = await db.query.changelogEntries.findMany({
            where: whereClause,
            orderBy: [desc(changelogEntries.createdAt)],
            limit: limit + 1, // Fetch one extra to check hasMore
            offset,
          })

          // Determine if there are more items
          const hasMore = entries.length > limit
          const items = hasMore ? entries.slice(0, limit) : entries

          // Calculate next cursor
          const nextOffset = offset + items.length
          const nextCursor = hasMore ? encodeCursor(nextOffset) : null

          return successResponse(
            items.map((entry) => ({
              id: entry.id,
              title: entry.title,
              content: entry.content,
              publishedAt: entry.publishedAt?.toISOString() || null,
              createdAt: entry.createdAt.toISOString(),
              updatedAt: entry.updatedAt.toISOString(),
            })),
            {
              pagination: {
                cursor: nextCursor,
                hasMore,
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
        // Authenticate
        const authResult = await withApiKeyAuth(request)
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

          // Import db
          const { db, changelogEntries } = await import('@/lib/server/db')

          // Create the changelog entry
          const [entry] = await db
            .insert(changelogEntries)
            .values({
              title: parsed.data.title,
              content: parsed.data.content,
              publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
            })
            .returning()

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
