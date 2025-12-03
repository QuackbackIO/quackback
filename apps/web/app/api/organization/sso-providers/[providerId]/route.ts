import { NextRequest, NextResponse } from 'next/server'
import { db, ssoProvider, eq, and } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { updateSsoProviderSchema } from '@/lib/schemas/sso-providers'

type RouteContext = {
  params: Promise<{ providerId: string }>
}

/**
 * PATCH /api/organization/sso-providers/[providerId]
 * Update an SSO provider
 */
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { providerId } = await params
    const body = await request.json()
    const { organizationId, ...updateData } = body

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only owners and admins can update SSO providers
    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Validate input
    const result = updateSsoProviderSchema.safeParse(updateData)
    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: result.error.issues },
        { status: 400 }
      )
    }

    // Find the existing provider
    const existingProvider = await db.query.ssoProvider.findFirst({
      where: and(
        eq(ssoProvider.id, providerId),
        eq(ssoProvider.organizationId, validation.organization.id)
      ),
    })

    if (!existingProvider) {
      return NextResponse.json({ error: 'SSO provider not found' }, { status: 404 })
    }

    // Check if domain is being changed and if it's already in use
    if (result.data.domain && result.data.domain !== existingProvider.domain) {
      const domainInUse = await db.query.ssoProvider.findFirst({
        where: eq(ssoProvider.domain, result.data.domain),
      })

      if (domainInUse) {
        return NextResponse.json(
          { error: 'Domain is already associated with an SSO provider' },
          { status: 409 }
        )
      }
    }

    // Build update object
    const updates: Record<string, unknown> = {}

    if (result.data.issuer) updates.issuer = result.data.issuer
    if (result.data.domain) updates.domain = result.data.domain
    if (result.data.oidcConfig) {
      // Merge with existing config to preserve fields not being updated
      const existingOidc = existingProvider.oidcConfig
        ? JSON.parse(existingProvider.oidcConfig)
        : {}
      updates.oidcConfig = JSON.stringify({
        ...existingOidc,
        ...result.data.oidcConfig,
      })
    }
    if (result.data.samlConfig) {
      const existingSaml = existingProvider.samlConfig
        ? JSON.parse(existingProvider.samlConfig)
        : {}
      updates.samlConfig = JSON.stringify({
        ...existingSaml,
        ...result.data.samlConfig,
      })
    }

    // Update the provider
    const [updated] = await db
      .update(ssoProvider)
      .set(updates)
      .where(eq(ssoProvider.id, providerId))
      .returning()

    return NextResponse.json({
      ...updated,
      oidcConfig: updated.oidcConfig ? maskOidcConfig(JSON.parse(updated.oidcConfig)) : null,
      samlConfig: updated.samlConfig ? JSON.parse(updated.samlConfig) : null,
    })
  } catch (error) {
    console.error('Error updating SSO provider:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/organization/sso-providers/[providerId]
 * Delete an SSO provider
 */
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { providerId } = await params
    const { searchParams } = new URL(request.url)
    const organizationId = searchParams.get('organizationId')

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only owners and admins can delete SSO providers
    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Find the existing provider
    const existingProvider = await db.query.ssoProvider.findFirst({
      where: and(
        eq(ssoProvider.id, providerId),
        eq(ssoProvider.organizationId, validation.organization.id)
      ),
    })

    if (!existingProvider) {
      return NextResponse.json({ error: 'SSO provider not found' }, { status: 404 })
    }

    // Delete the provider
    await db.delete(ssoProvider).where(eq(ssoProvider.id, providerId))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting SSO provider:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Mask sensitive fields in OIDC config for safe display
 */
function maskOidcConfig(config: Record<string, unknown>) {
  return {
    ...config,
    clientSecret: config.clientSecret ? '••••••••' : undefined,
  }
}
