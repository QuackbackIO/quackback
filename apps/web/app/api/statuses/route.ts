import { NextResponse } from 'next/server'
import {
  getStatusesByOrganization,
  createStatus,
  getStatusBySlug,
  type StatusCategory,
} from '@quackback/db'
import { withApiHandler, validateBody, ApiError, successResponse } from '@/lib/api-handler'
import { z } from 'zod'

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
  const statuses = await getStatusesByOrganization(validation.organization.id)
  return NextResponse.json(statuses)
})

/**
 * POST /api/statuses
 * Create a new status
 */
export const POST = withApiHandler(async (request, { validation }) => {
  const body = await request.json()
  const { name, slug, color, category, position, showOnRoadmap, isDefault } = validateBody(
    createStatusSchema,
    body
  )

  // Check if slug already exists for this org
  const existingStatus = await getStatusBySlug(validation.organization.id, slug)
  if (existingStatus) {
    throw new ApiError('A status with this slug already exists', 409)
  }

  // Create the status
  const status = await createStatus({
    organizationId: validation.organization.id,
    name,
    slug,
    color,
    category: category as StatusCategory,
    position: position ?? 0,
    showOnRoadmap: showOnRoadmap ?? false,
    isDefault: isDefault ?? false,
  })

  return successResponse(status, 201)
})
