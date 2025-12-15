import { NextResponse } from 'next/server'
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
import { isValidTypeId, type StatusId, type PostId } from '@quackback/ids'
// Note: StatusId still used for GET query params

type RouteParams = { roadmapId: string }

// Accept TypeID strings and validate in route handler
const addPostSchema = z.object({
  postId: z.string(),
})

const removePostSchema = z.object({
  postId: z.string(),
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
 * GET /api/roadmaps/[roadmapId]/posts
 * Get posts for a roadmap, optionally filtered by status
 */
export const GET = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  // Parse TypeID to UUID for database query
  const roadmapId = parseId(params.roadmapId, 'roadmap')
  const { searchParams } = new URL(request.url)

  // Parse optional statusId TypeID
  const statusIdParam = searchParams.get('statusId')
  let statusId: StatusId | undefined
  if (statusIdParam) {
    if (!isValidTypeId(statusIdParam, 'status')) {
      throw new ApiError('Invalid status ID format', 400)
    }
    statusId = statusIdParam as StatusId
  }

  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().getRoadmapPosts(
    roadmapId,
    { statusId, limit, offset },
    ctx
  )

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  // Response is already in TypeID format from service layer
  return NextResponse.json(result.value)
})

/**
 * POST /api/roadmaps/[roadmapId]/posts
 * Add a post to a roadmap
 */
export const POST = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  // Parse TypeID to UUID for database query
  const roadmapId = parseId(params.roadmapId, 'roadmap')
  const body = await request.json()
  const { postId: postIdTypeId } = validateBody(addPostSchema, body)

  // Validate TypeID format
  if (!isValidTypeId(postIdTypeId, 'post')) {
    throw new ApiError('Invalid post ID format', 400)
  }
  const postId = postIdTypeId as PostId

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().addPostToRoadmap({ postId, roadmapId }, ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  return successResponse({ added: true }, 201)
})

/**
 * DELETE /api/roadmaps/[roadmapId]/posts
 * Remove a post from a roadmap
 */
export const DELETE = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  // Parse TypeID to UUID for database query
  const roadmapId = parseId(params.roadmapId, 'roadmap')
  const body = await request.json()
  const { postId: postIdTypeId } = validateBody(removePostSchema, body)

  // Validate TypeID format
  if (!isValidTypeId(postIdTypeId, 'post')) {
    throw new ApiError('Invalid post ID format', 400)
  }
  const postId = postIdTypeId as PostId

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().removePostFromRoadmap(postId, roadmapId, ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  return successResponse({ removed: true })
})
