import { db, boards, eq } from '@quackback/db'
import { withApiHandlerParams, verifyResourceOwnership, successResponse } from '@/lib/api-handler'

type RouteParams = { boardId: string }

export const PATCH = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  const { boardId } = params
  const body = await request.json()
  const { name, description, isPublic, settings } = body

  // Get and verify board ownership
  const board = await db.query.boards.findFirst({
    where: eq(boards.id, boardId),
  })
  verifyResourceOwnership(board, validation.organization.id, 'Board')

  // Merge settings with existing settings if provided
  let mergedSettings = board.settings
  if (settings !== undefined) {
    mergedSettings = {
      ...((board.settings as object) || {}),
      ...settings,
    }
  }

  // Update the board
  const [updatedBoard] = await db
    .update(boards)
    .set({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(isPublic !== undefined && { isPublic }),
      ...(settings !== undefined && { settings: mergedSettings }),
      updatedAt: new Date(),
    })
    .where(eq(boards.id, boardId))
    .returning()

  return successResponse(updatedBoard)
})

export const DELETE = withApiHandlerParams<RouteParams>(
  async (_request, { validation, params }) => {
    const { boardId } = params

    // Get and verify board ownership
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    })
    verifyResourceOwnership(board, validation.organization.id, 'Board')

    // Delete the board
    await db.delete(boards).where(eq(boards.id, boardId))

    return successResponse({ success: true })
  }
)
