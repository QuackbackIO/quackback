import {
  withApiHandlerParams,
  validateBody,
  ApiError,
  successResponse,
  parseId,
} from '@/lib/api-handler'
import { z } from 'zod'
import { getRoadmapService } from '@/lib/services'
import { buildServiceContext, type RoadmapError } from '@quackback/domain'
import { isValidTypeId, type PostId } from '@quackback/ids'

type RouteParams = { roadmapId: string }

// Accept TypeID strings and validate in route handler
const reorderPostsSchema = z.object({
  postIds: z.array(z.string()),
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
 * Reorder posts within a roadmap
 */
export const PUT = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  // Parse TypeID to UUID for database query
  const roadmapId = parseId(params.roadmapId, 'roadmap')
  const body = await request.json()
  const { postIds: postIdsTypeId } = validateBody(reorderPostsSchema, body)

  // Validate TypeIDs
  const postIds = postIdsTypeId.map((id) => {
    if (!isValidTypeId(id, 'post')) {
      throw new ApiError(`Invalid post ID format: ${id}`, 400)
    }
    return id as PostId
  })

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().reorderPostsInColumn({ roadmapId, postIds }, ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  return successResponse({ reordered: true })
})
