import { NextRequest, NextResponse } from 'next/server'
import { db, organization, eq } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, strictSsoMode } = body

    // Validate tenant access (handles auth + org membership check)
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only owners and admins can update security settings
    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Validate input
    if (typeof strictSsoMode !== 'boolean') {
      return NextResponse.json({ error: 'strictSsoMode must be a boolean' }, { status: 400 })
    }

    // Update the organization
    const [updated] = await db
      .update(organization)
      .set({ strictSsoMode })
      .where(eq(organization.id, organizationId))
      .returning()

    return NextResponse.json({
      success: true,
      strictSsoMode: updated.strictSsoMode,
    })
  } catch (error) {
    console.error('Error updating organization security settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
