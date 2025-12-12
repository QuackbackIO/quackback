import { NextResponse } from 'next/server'
import { withApiHandlerParams, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { z } from 'zod'
import { getRoadmapService } from '@/lib/services'
import { buildServiceContext, type RoadmapError } from '@quackback/domain'

type RouteParams = { roadmapId: string }

const addPostSchema = z.object({
  postId: z.string().uuid(),
  statusId: z.string().uuid(),
})

const removePostSchema = z.object({
  postId: z.string().uuid(),
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
  const { roadmapId } = params
  const { searchParams } = new URL(request.url)
  const statusId = searchParams.get('statusId') || undefined
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

  return NextResponse.json(result.value)
})

/**
 * POST /api/roadmaps/[roadmapId]/posts
 * Add a post to a roadmap
 */
export const POST = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  const { roadmapId } = params
  const body = await request.json()
  const { postId, statusId } = validateBody(addPostSchema, body)

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().addPostToRoadmap({ postId, roadmapId, statusId }, ctx)

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
  const { roadmapId } = params
  const body = await request.json()
  const { postId } = validateBody(removePostSchema, body)

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().removePostFromRoadmap(postId, roadmapId, ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  return successResponse({ removed: true })
})
