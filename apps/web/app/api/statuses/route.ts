import { NextResponse } from 'next/server'
import { withApiHandler, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { z } from 'zod'
import { getStatusService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'

const createStatusSchema = z.object({
  name: z.string().min(1).max(50),
  slug: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/, 'Slug must be lowercase with underscores'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format'),
  category: z.enum(['active', 'complete', 'closed']),
  position: z.number().int().min(0).optional(),
  showOnRoadmap: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

/**
 * GET /api/statuses
 * List all statuses for an organization
 */
export const GET = withApiHandler(async (_request, { validation }) => {
  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call StatusService to list statuses
  const result = await getStatusService().listStatuses(ctx)

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

  return NextResponse.json(result.value)
})

/**
 * POST /api/statuses
 * Create a new status
 */
export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const input = validateBody(createStatusSchema, body)

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call StatusService to create the status
  const result = await getStatusService().createStatus(input, ctx)

  // Map Result to HTTP response
  if (!result.success) {
    const error = result.error

    // Map domain errors to HTTP status codes
    switch (error.code) {
      case 'STATUS_NOT_FOUND':
        throw new ApiError(error.message, 404)
      case 'DUPLICATE_SLUG':
        throw new ApiError(error.message, 409)
      case 'UNAUTHORIZED':
        throw new ApiError(error.message, 403)
      case 'VALIDATION_ERROR':
        throw new ApiError(error.message, 400)
      case 'CANNOT_DELETE_DEFAULT':
        throw new ApiError(error.message, 400)
      case 'CANNOT_DELETE_IN_USE':
        throw new ApiError(error.message, 400)
      default:
        throw new ApiError('Internal server error', 500)
    }
  }

  return successResponse(result.value, 201)
})
