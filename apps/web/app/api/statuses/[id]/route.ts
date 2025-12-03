import { NextRequest, NextResponse } from 'next/server'
import {
  getStatusById,
  updateStatus,
  deleteStatus,
  getStatusUsageCount,
  setDefaultStatus,
} from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { z } from 'zod'

const updateStatusSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid color format')
    .optional(),
  showOnRoadmap: z.boolean().optional(),
  isDefault: z.boolean().optional(),
})

/**
 * GET /api/statuses/[id]
 * Get a single status by ID
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    const status = await getStatusById(id)

    if (!status) {
      return NextResponse.json({ error: 'Status not found' }, { status: 404 })
    }

    // Verify status belongs to this organization
    if (status.organizationId !== validation.organization.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json(status)
  } catch (error) {
    console.error('Error fetching status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/statuses/[id]
 * Update a status
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    // Validate input
    const parsed = updateStatusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { organizationId, name, color, showOnRoadmap, isDefault } = parsed.data

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Get the status to verify ownership
    const status = await getStatusById(id)

    if (!status) {
      return NextResponse.json({ error: 'Status not found' }, { status: 404 })
    }

    // Verify status belongs to this organization
    if (status.organizationId !== validation.organization.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

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
  } catch (error) {
    console.error('Error updating status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/statuses/[id]
 * Delete a status
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Get the status to verify ownership
    const status = await getStatusById(id)

    if (!status) {
      return NextResponse.json({ error: 'Status not found' }, { status: 404 })
    }

    // Verify status belongs to this organization
    if (status.organizationId !== validation.organization.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if status is the default
    if (status.isDefault) {
      return NextResponse.json(
        { error: 'Cannot delete the default status. Set another status as default first.' },
        { status: 400 }
      )
    }

    // Check if any posts are using this status
    const usageCount = await getStatusUsageCount(id)
    if (usageCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete status. ${usageCount} post(s) are using this status. Reassign them first.`,
          usageCount,
        },
        { status: 400 }
      )
    }

    // Delete the status
    await deleteStatus(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting status:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
