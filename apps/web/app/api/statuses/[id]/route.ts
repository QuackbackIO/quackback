import { NextResponse } from 'next/server'
import {
  withApiHandlerParams,
  validateBody,
  ApiError,
  successResponse,
  parseId,
} from '@/lib/api-handler'
import { z } from 'zod'
import { getStatusService } from '@/lib/services'
import { buildServiceContext } from '@quackback/domain'

const updateStatusSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format')
    .optional(),
  showOnRoadmap: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

type RouteParams = { id: string }

/**
 * GET /api/statuses/[id]
 * Get a single status by ID
 */
export const GET = withApiHandlerParams<RouteParams>(async (_request, { validation, params }) => {
  const { id: idParam } = params

  // Parse TypeID to UUID for database query
  const id = parseId(idParam, 'status')

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call StatusService to get the status
  const result = await getStatusService().getStatusById(id, ctx)

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

  // Response is already in TypeID format from service layer
  return NextResponse.json(result.value)
})

/**
 * PATCH /api/statuses/[id]
 * Update a status
 */
export const PATCH = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  const { id: idParam } = params
  const body = await request.json()
  const input = validateBody(updateStatusSchema, body)

  // Validate TypeID format
  const id = parseId(idParam, 'status')

  // Build service context from validation
  const ctx = buildServiceContext(validation)

  // Call StatusService to update the status
  const result = await getStatusService().updateStatus(id, input, ctx)

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

  // Response is already in TypeID format from service layer
  return NextResponse.json(result.value)
})

/**
 * DELETE /api/statuses/[id]
 * Delete a status
 */
export const DELETE = withApiHandlerParams<RouteParams>(
  async (_request, { validation, params }) => {
    const { id: idParam } = params

    // Parse TypeID to UUID for database query
    const id = parseId(idParam, 'status')

    // Build service context from validation
    const ctx = buildServiceContext(validation)

    // Call StatusService to delete the status
    const result = await getStatusService().deleteStatus(id, ctx)

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

    return successResponse({ success: true })
  }
)
