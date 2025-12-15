import { withApiHandler, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { createBoardSchema } from '@/lib/schemas/boards'
import { getBoardService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'

export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const input = validateBody(createBoardSchema, body)

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call BoardService to create the board
  const result = await getBoardService().createBoard(input, ctx)

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
  return successResponse(result.value, 201)
})

export const GET = withApiHandler(async (_request, { validation }) => {
  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call BoardService to list boards
  const result = await getBoardService().listBoards(ctx)

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
