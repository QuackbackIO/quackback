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
import { validateTypeId } from '@/lib/server/domains/api/validation'
import type { BoardId } from '@quackback/ids'

// Input validation schema
const createChangelogSchema = z.object({
  boardId: z.string().min(1, 'Board ID is required'),
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
          const boardIdParam = url.searchParams.get('boardId')
          const published = url.searchParams.get('published')
          const cursor = url.searchParams.get('cursor') ?? undefined
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10), 100)
          const offset = decodeCursor(cursor)

          // Validate boardId if provided
          let boardId: BoardId | null = null
          if (boardIdParam) {
            const { isValidTypeId } = await import('@quackback/ids')
            if (!isValidTypeId(boardIdParam, 'board')) {
              return badRequestResponse('Invalid board ID format', {
                errors: { boardId: ['Must be a valid board TypeID'] },
              })
            }
            boardId = boardIdParam as BoardId
          }

          // Import db
          const { db, changelogEntries, eq, desc, and, isNotNull, isNull } =
            await import('@/lib/db')

          // Build conditions
          const conditions = []
          if (boardId) {
            conditions.push(eq(changelogEntries.boardId, boardId))
          }
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
            with: {
              board: true,
            },
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
              boardId: entry.boardId,
              boardName: entry.board?.name,
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

          // Validate TypeID format in request body
          const validationError = validateTypeId(parsed.data.boardId, 'board', 'board ID')
          if (validationError) return validationError

          // Import db
          const { db, changelogEntries, boards, eq } = await import('@/lib/db')
          const { NotFoundError } = await import('@/lib/shared/errors')

          // Verify board exists
          const board = await db.query.boards.findFirst({
            where: eq(boards.id, parsed.data.boardId as BoardId),
          })
          if (!board) {
            throw new NotFoundError(
              'BOARD_NOT_FOUND',
              `Board with ID ${parsed.data.boardId} not found`
            )
          }

          // Create the changelog entry
          const [entry] = await db
            .insert(changelogEntries)
            .values({
              boardId: parsed.data.boardId as BoardId,
              title: parsed.data.title,
              content: parsed.data.content,
              publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
            })
            .returning()

          return createdResponse({
            id: entry.id,
            boardId: entry.boardId,
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
