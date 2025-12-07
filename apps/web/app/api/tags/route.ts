import { NextResponse } from 'next/server'
import { withApiHandler, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { getTagService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'
import { z } from 'zod'

const createTagSchema = z.object({
  name: z.string().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color (e.g., #6b7280)')
    .optional(),
})

/**
 * GET /api/tags
 * List all tags for the organization
 */
export const GET = withApiHandler(async (_request, { validation }) => {
  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call TagService to list tags
  const result = await getTagService().listTags(ctx)

  // Map Result to HTTP response
  if (!result.success) {
    const error = result.error

    // Map domain errors to HTTP status codes
    switch (error.code) {
      case 'TAG_NOT_FOUND':
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
 * POST /api/tags
 * Create a new tag
 */
export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const input = validateBody(createTagSchema, body)

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call TagService to create the tag
  const result = await getTagService().createTag(input, ctx)

  // Map Result to HTTP response
  if (!result.success) {
    const error = result.error

    // Map domain errors to HTTP status codes
    switch (error.code) {
      case 'TAG_NOT_FOUND':
        throw new ApiError(error.message, 404)
      case 'DUPLICATE_NAME':
        throw new ApiError(error.message, 409)
      case 'UNAUTHORIZED':
        throw new ApiError(error.message, 403)
      case 'VALIDATION_ERROR':
        throw new ApiError(error.message, 400)
      default:
        throw new ApiError('Internal server error', 500)
    }
  }

  return successResponse(result.value, 201)
})
