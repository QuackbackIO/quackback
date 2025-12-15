import { NextRequest } from 'next/server'
import { withApiHandler, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { z } from 'zod'
import { getRoadmapService } from '@/lib/services'
import { buildServiceContext, type RoadmapError } from '@quackback/domain'
import { isValidTypeId, type RoadmapId } from '@quackback/ids'

// Accept TypeID strings and validate in route handler
const reorderRoadmapsSchema = z.object({
  roadmapIds: z.array(z.string()),
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
 * PUT /api/roadmaps/reorder
 * Reorder roadmaps in the sidebar
 */
export const PUT = withApiHandler(async (request: NextRequest, { validation }) => {
  const body = await request.json()
  const { roadmapIds: roadmapIdsTypeId } = validateBody(reorderRoadmapsSchema, body)

  // Validate TypeIDs
  const roadmapIds = roadmapIdsTypeId.map((id) => {
    if (!isValidTypeId(id, 'roadmap')) {
      throw new ApiError(`Invalid roadmap ID format: ${id}`, 400)
    }
    return id as RoadmapId
  })

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().reorderRoadmaps(roadmapIds, ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  return successResponse({ reordered: true })
})
