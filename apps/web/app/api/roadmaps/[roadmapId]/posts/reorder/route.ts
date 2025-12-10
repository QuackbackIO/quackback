import { withApiHandlerParams, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { z } from 'zod'
import { getRoadmapService } from '@/lib/services'
import { buildServiceContext, type RoadmapError } from '@quackback/domain'

type RouteParams = { roadmapId: string }

const reorderPostsSchema = z.object({
  statusId: z.string().uuid(),
  postIds: z.array(z.string().uuid()),
})

/**
 * Map RoadmapError codes to HTTP status codes
 */
function mapErrorToStatus(error: RoadmapError): number {
  switch (error.code) {
    case 'ROADMAP_NOT_FOUND':
    case 'POST_NOT_FOUND':
    case 'STATUS_NOT_FOUND':
      return 404
    case 'DUPLICATE_SLUG':
    case 'POST_ALREADY_IN_ROADMAP':
      return 409
    case 'UNAUTHORIZED':
      return 403
    case 'VALIDATION_ERROR':
    case 'POST_NOT_IN_ROADMAP':
      return 400
    default:
      return 500
  }
}

/**
 * PUT /api/roadmaps/[roadmapId]/posts/reorder
 * Reorder posts within a roadmap column
 */
export const PUT = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  const { roadmapId } = params
  const body = await request.json()
  const { statusId, postIds } = validateBody(reorderPostsSchema, body)

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().reorderPostsInColumn(
    { roadmapId, statusId, postIds },
    ctx
  )

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  return successResponse({ reordered: true })
})
