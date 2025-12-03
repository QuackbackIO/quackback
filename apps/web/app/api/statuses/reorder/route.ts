import { NextRequest, NextResponse } from 'next/server'
import { reorderStatuses, type StatusCategory } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { z } from 'zod'

const reorderSchema = z.object({
  organizationId: z.string(),
  category: z.enum(['active', 'complete', 'closed']),
  statusIds: z.array(z.string().uuid()).min(1),
})

/**
 * PUT /api/statuses/reorder
 * Reorder statuses within a category
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate input
    const parsed = reorderSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const { organizationId, category, statusIds } = parsed.data

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Reorder the statuses
    await reorderStatuses(validation.organization.id, category as StatusCategory, statusIds)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error reordering statuses:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
