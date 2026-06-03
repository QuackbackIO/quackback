import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { withApiKeyAuth } from '@/lib/server/domains/api/auth'
import {
  successResponse,
  createdResponse,
  badRequestResponse,
  handleDomainError,
} from '@/lib/server/domains/api/responses'
// Input validation schema — `audience` and `access` are intentionally
// excluded, matching the strip on PATCH /api/v1/boards/:boardId. Visibility
// is a policy-level setting changed only via updateBoardAccessFn (admin-only,
// audited); accepting it here would let a member-role API key silently
// create a board with restricted visibility (or, worse, a segments tier
// with an empty allowlist — a board no one can see) without an audit
// event. New boards default to DEFAULT_BOARD_ACCESS in createBoard.
const createBoardSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug must contain only lowercase letters, numbers, and hyphens')
    .optional(),
  description: z.string().max(500).optional(),
})

export const Route = createFileRoute('/api/v1/boards/')({
  server: {
    handlers: {
      /**
       * GET /api/v1/boards
       * List all boards
       */
      GET: async ({ request }) => {
        try {
          await withApiKeyAuth(request, { role: 'team' })

          // Import service function
          const { listBoardsWithDetails, accessToAudience } =
            await import('@/lib/server/domains/boards/board.service')

          const boards = await listBoardsWithDetails()

          return successResponse(
            boards.map((board) => ({
              id: board.id,
              name: board.name,
              slug: board.slug,
              description: board.description,
              // Legacy contract: synthesised from board.access for back-compat.
              audience: accessToAudience(board.access),
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
        try {
          await withApiKeyAuth(request, { role: 'team' })

          // Parse and validate body
          const body = await request.json()
          const parsed = createBoardSchema.safeParse(body)

          if (!parsed.success) {
            return badRequestResponse('Invalid request body', {
              errors: parsed.error.flatten().fieldErrors,
            })
          }

          // Import service function
          const { createBoard, accessToAudience } =
            await import('@/lib/server/domains/boards/board.service')

          const board = await createBoard({
            name: parsed.data.name,
            slug: parsed.data.slug,
            description: parsed.data.description,
          })

          return createdResponse({
            id: board.id,
            name: board.name,
            slug: board.slug,
            description: board.description,
            audience: accessToAudience(board.access),
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
