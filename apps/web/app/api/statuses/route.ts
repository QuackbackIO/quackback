import { NextRequest, NextResponse } from 'next/server'
import {
  getStatusesByOrganization,
  createStatus,
  getStatusBySlug,
  type StatusCategory,
} from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { z } from 'zod'

const createStatusSchema = z.object({
  organizationId: z.string(),
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
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    const statuses = await getStatusesByOrganization(validation.organization.id)

    return NextResponse.json(statuses)
  } catch (error) {
    console.error('Error fetching statuses:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/statuses
 * Create a new status
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    const parsed = createStatusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { organizationId, name, slug, color, category, position, showOnRoadmap, isDefault } =
      parsed.data

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Check if slug already exists for this org
    const existingStatus = await getStatusBySlug(validation.organization.id, slug)
    if (existingStatus) {
      return NextResponse.json({ error: 'A status with this slug already exists' }, { status: 409 })
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

    return NextResponse.json(status, { status: 201 })
  } catch (error) {
    console.error('Error creating status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
