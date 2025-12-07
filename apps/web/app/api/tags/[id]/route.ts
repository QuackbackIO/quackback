import { NextResponse } from 'next/server'
import { withApiHandlerParams, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { getTagService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'
import { z } from 'zod'

const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Color must be a valid hex color (e.g., #6b7280)')
    .optional(),
})

type RouteParams = { id: string }

/**
 * GET /api/tags/[id]
 * Get a single tag by ID
 */
export const GET = withApiHandlerParams<RouteParams>(async (_request, { validation, params }) => {
  const { id } = params

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call TagService to get the tag
  const result = await getTagService().getTagById(id, ctx)

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
 * PATCH /api/tags/[id]
 * Update a tag
 */
export const PATCH = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  const { id } = params
  const body = await request.json()
  const input = validateBody(updateTagSchema, body)

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call TagService to update the tag
  const result = await getTagService().updateTag(id, input, ctx)

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

  return NextResponse.json(result.value)
})

/**
 * DELETE /api/tags/[id]
 * Delete a tag
 */
export const DELETE = withApiHandlerParams<RouteParams>(
  async (_request, { validation, params }) => {
    const { id } = params

    // Build service context from validation
    const ctx = buildServiceContext(validation)

    // Call TagService to delete the tag
    const result = await getTagService().deleteTag(id, ctx)

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

    return successResponse({ success: true })
  }
)
