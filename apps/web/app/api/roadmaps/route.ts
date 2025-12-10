import { NextResponse } from 'next/server'
import { withApiHandler, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { z } from 'zod'
import { getRoadmapService } from '@/lib/services'
import { buildServiceContext, type RoadmapError } from '@quackback/domain'

const createRoadmapSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase with hyphens'),
  description: z.string().max(500).optional(),
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
 * GET /api/roadmaps
 * List all roadmaps for the organization
 */
export const GET = withApiHandler(async (_request, { validation }) => {
  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().listRoadmaps(ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  return NextResponse.json(result.value)
})

/**
 * POST /api/roadmaps
 * Create a new roadmap
 */
export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const input = validateBody(createRoadmapSchema, body)

  const ctx = buildServiceContext(validation)
  const result = await getRoadmapService().createRoadmap(input, ctx)

  if (!result.success) {
    throw new ApiError(result.error.message, mapErrorToStatus(result.error))
  }

  return successResponse(result.value, 201)
})
