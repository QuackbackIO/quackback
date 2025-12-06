import { NextResponse } from 'next/server'
import {
  getStatusById,
  updateStatus,
  deleteStatus,
  getStatusUsageCount,
  setDefaultStatus,
} from '@quackback/db'
import {
  withApiHandlerParams,
  verifyResourceOwnership,
  validateBody,
  ApiError,
  successResponse,
} from '@/lib/api-handler'
import { z } from 'zod'

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
  const { id } = params
  const status = await getStatusById(id)
  verifyResourceOwnership(status, validation.organization.id, 'Status')

  return NextResponse.json(status)
})

/**
 * PATCH /api/statuses/[id]
 * Update a status
 */
export const PATCH = withApiHandlerParams<RouteParams>(async (request, { validation, params }) => {
  const { id } = params
  const body = await request.json()
  const { name, color, showOnRoadmap, isDefault } = validateBody(updateStatusSchema, body)

  // Get and verify status ownership
  const status = await getStatusById(id)
  verifyResourceOwnership(status, validation.organization.id, 'Status')

  // If setting as default, use the special function
  if (isDefault === true) {
    await setDefaultStatus(validation.organization.id, id)
  }

  // Update the status
  const updatedStatus = await updateStatus(id, {
    ...(name !== undefined && { name }),
    ...(color !== undefined && { color }),
    ...(showOnRoadmap !== undefined && { showOnRoadmap }),
    ...(isDefault === false && { isDefault: false }),
  })

  return NextResponse.json(updatedStatus)
})

/**
 * DELETE /api/statuses/[id]
 * Delete a status
 */
export const DELETE = withApiHandlerParams<RouteParams>(
  async (_request, { validation, params }) => {
    const { id } = params

    // Get and verify status ownership
    const status = await getStatusById(id)
    verifyResourceOwnership(status, validation.organization.id, 'Status')

    // Check if status is the default
    if (status.isDefault) {
      throw new ApiError(
        'Cannot delete the default status. Set another status as default first.',
        400
      )
    }

    // Check if any posts are using this status
    const usageCount = await getStatusUsageCount(id)
    if (usageCount > 0) {
      throw new ApiError(
        `Cannot delete status. ${usageCount} post(s) are using this status. Reassign them first.`,
        400
      )
    }

    // Delete the status
    await deleteStatus(id)

    return successResponse({ success: true })
  }
)
