import { withApiHandlerParams, ApiError, successResponse, parseId } from '@/lib/api-handler'
import { getBoardService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'

type RouteParams = { boardId: string }

export const PATCH = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  const { boardId: boardIdParam } = params
  const body = await request.json()
  const { name, description, isPublic, settings } = body

  // Parse TypeID to UUID for database query
  const boardId = parseId(boardIdParam, 'board')

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Build update input
  const input: {
    name?: string
    description?: string | null
    isPublic?: boolean
    settings?: Record<string, unknown>
  } = {}

  if (name !== undefined) input.name = name
  if (description !== undefined) input.description = description
  if (isPublic !== undefined) input.isPublic = isPublic
  if (settings !== undefined) input.settings = settings

  // Call BoardService to update the board
  const result = await getBoardService().updateBoard(boardId, input, ctx)

  // Map Result to HTTP response
  if (!result.success) {
    const error = result.error

    // Map domain errors to HTTP status codes
    switch (error.code) {
      case 'BOARD_NOT_FOUND':
        throw new ApiError(error.message, 404)
      case 'DUPLICATE_SLUG':
        throw new ApiError(error.message, 409)
      case 'UNAUTHORIZED':
        throw new ApiError(error.message, 403)
      case 'VALIDATION_ERROR':
        throw new ApiError(error.message, 400)
      default:
        throw new ApiError('Internal server error', 500)
    }
  }

  // Response is already in TypeID format from service layer
  return successResponse(result.value)
})

export const DELETE = withApiHandlerParams<RouteParams>(
  async (_request, { validation, params }) => {
    const { boardId: boardIdParam } = params

    // Parse TypeID to UUID for database query
    const boardId = parseId(boardIdParam, 'board')

    // Build service context from validation
    const ctx = buildServiceContext(validation)

    // Call BoardService to delete the board
    const result = await getBoardService().deleteBoard(boardId, ctx)

    // Map Result to HTTP response
    if (!result.success) {
      const error = result.error

      // Map domain errors to HTTP status codes
      switch (error.code) {
        case 'BOARD_NOT_FOUND':
          throw new ApiError(error.message, 404)
        case 'DUPLICATE_SLUG':
          throw new ApiError(error.message, 409)
        case 'UNAUTHORIZED':
          throw new ApiError(error.message, 403)
        case 'VALIDATION_ERROR':
          throw new ApiError(error.message, 400)
        default:
          throw new ApiError('Internal server error', 500)
      }
    }

    return successResponse({ success: true })
  }
)
