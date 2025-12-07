import { withApiHandler, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { z } from 'zod'
import { getStatusService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'

const reorderSchema = z.object({
  category: z.enum(['active', 'complete', 'closed']).optional(),
  statusIds: z.array(z.string().uuid()).min(1),
})

/**
 * PUT /api/statuses/reorder
 * Reorder statuses within a category
 */
export const PUT = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const { statusIds } = validateBody(reorderSchema, body)

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call StatusService to reorder the statuses
  const result = await getStatusService().reorderStatuses(statusIds, ctx)

  // Map Result to HTTP response
  if (!result.success) {
    const error = result.error

    // Map domain errors to HTTP status codes
    switch (error.code) {
      case 'STATUS_NOT_FOUND':
        throw new ApiError(error.message, 404)
      case 'UNAUTHORIZED':
        throw new ApiError(error.message, 403)
      case 'VALIDATION_ERROR':
        throw new ApiError(error.message, 400)
      default:
        throw new ApiError('Internal server error', 500)
    }
  }

  return successResponse({ success: true })
})
