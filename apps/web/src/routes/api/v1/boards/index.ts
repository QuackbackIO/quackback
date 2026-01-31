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
const createBoardSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .optional(),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().optional().default(true),
})

export const Route = createFileRoute('/api/v1/boards/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/boards
       * List all boards
       */
      GET: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          // Import service function
          const { listBoardsWithDetails } = await import('@/lib/boards/board.service')

          const boards = await listBoardsWithDetails()

          return successResponse(
            boards.map((board) => ({
              id: board.id,
              name: board.name,
              slug: board.slug,
              description: board.description,
              isPublic: board.isPublic,
              postCount: board.postCount,
              createdAt: board.createdAt.toISOString(),
              updatedAt: board.updatedAt.toISOString(),
            }))
          )
        } catch (error) {
          return handleDomainError(error)
        }
      },

      /**
       * POST /api/v1/boards
       * Create a new board
       */
      POST: async ({ request }) => {
        // Authenticate
        const authResult = await withApiKeyAuth(request)
        if (authResult instanceof Response) return authResult

        try {
          // Parse and validate body
          const body = await request.json()
          const parsed = createBoardSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { createBoard } = await import('@/lib/boards/board.service')

          const board = await createBoard({
            name: parsed.data.name,
            slug: parsed.data.slug,
            description: parsed.data.description,
            isPublic: parsed.data.isPublic,
          })

          return createdResponse({
            id: board.id,
            name: board.name,
            slug: board.slug,
            description: board.description,
            isPublic: board.isPublic,
            createdAt: board.createdAt.toISOString(),
            updatedAt: board.updatedAt.toISOString(),
          })
        } catch (error) {
          return handleDomainError(error)
        }
      },
    },
  },
})
