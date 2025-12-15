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

type RouteParams = { roadmapId: string }

const updateRoadmapSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  isPublic: z.boolean().optional(),
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
 * GET /api/roadmaps/[roadmapId]
 * Get a single roadmap by ID
 */
export const GET = withApiHandlerParams<RouteParams>(async (_request, { validation, params }) => {
  // Parse TypeID to UUID for database query
  const roadmapId = parseId(params.roadmapId, 'roadmap')
  const ctx = buildServiceContext(validation)

  const result = await getRoadmapService().getRoadmap(roadmapId, ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  // Response is already in TypeID format from service layer
  return NextResponse.json(result.value)
})

/**
 * PATCH /api/roadmaps/[roadmapId]
 * Update a roadmap
 */
export const PATCH = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  // Validate TypeID format
  const roadmapId = parseId(params.roadmapId, 'roadmap')
  const body = await request.json()
  const parsed = validateBody(updateRoadmapSchema, body)

  // Convert null description to undefined for the service
  const input = {
    ...parsed,
    description: parsed.description === null ? undefined : parsed.description,
  }

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().updateRoadmap(roadmapId, input, ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  // Response is already in TypeID format from service layer
  return NextResponse.json(result.value)
})

/**
 * DELETE /api/roadmaps/[roadmapId]
 * Delete a roadmap
 */
export const DELETE = withApiHandlerParams<RouteParams>(
  async (_request, { validation, params }) => {
    // Parse TypeID to UUID for database query
    const roadmapId = parseId(params.roadmapId, 'roadmap')
    const ctx = buildServiceContext(validation)

    const result = await getRoadmapService().deleteRoadmap(roadmapId, ctx)

    if (!result.success) {
      throw new ApiError(result.error.message, mapErrorToStatus(result.error))
    }

    return successResponse({ deleted: true })
  }
)
