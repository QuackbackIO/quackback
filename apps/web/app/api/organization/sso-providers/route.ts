import { NextRequest, NextResponse } from 'next/server'
import { db, ssoProvider, eq } from '@quackback/db'
import { validateApiTenantAccess } from '@/lib/tenant'
import { createSsoProviderSchema } from '@/lib/schemas/sso-providers'

/**
 * GET /api/organization/sso-providers
 * List all SSO providers for an organization
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

    // Only owners and admins can view SSO providers
    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Fetch SSO providers for this organization
    const providers = await db.query.ssoProvider.findMany({
      where: eq(ssoProvider.organizationId, validation.organization.id),
      orderBy: (ssoProvider, { desc }) => [desc(ssoProvider.createdAt)],
    })

    // Parse JSON configs and mask secrets
    const safeProviders = providers.map((provider) => ({
      ...provider,
      oidcConfig: provider.oidcConfig ? maskOidcConfig(JSON.parse(provider.oidcConfig)) : null,
      samlConfig: provider.samlConfig ? JSON.parse(provider.samlConfig) : null,
    }))

    return NextResponse.json(safeProviders)
  } catch (error) {
    console.error('Error fetching SSO providers:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/organization/sso-providers
 * Create a new SSO provider
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { organizationId, ...providerData } = body

    // Validate tenant access
    const validation = await validateApiTenantAccess(organizationId)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    // Only owners and admins can create SSO providers
    if (!['owner', 'admin'].includes(validation.member.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Validate input
    const result = createSsoProviderSchema.safeParse(providerData)
    if (!result.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: result.error.issues },
        { status: 400 }
      )
    }

    const { type, issuer, domain, oidcConfig, samlConfig } = result.data

    // Check if domain is already in use
    const existingProvider = await db.query.ssoProvider.findFirst({
      where: eq(ssoProvider.domain, domain),
    })

    if (existingProvider) {
      return NextResponse.json(
        { error: 'Domain is already associated with an SSO provider' },
        { status: 409 }
      )
    }

    // Generate a unique provider ID
    const providerId = `sso_${validation.organization.slug}_${type}_${Date.now()}`

    // Create the SSO provider
    const [created] = await db
      .insert(ssoProvider)
      .values({
        id: crypto.randomUUID(),
        organizationId: validation.organization.id,
        issuer,
        domain,
        providerId,
        oidcConfig: oidcConfig ? JSON.stringify(oidcConfig) : null,
        samlConfig: samlConfig ? JSON.stringify(samlConfig) : null,
      })
      .returning()

    return NextResponse.json({
      ...created,
      oidcConfig: created.oidcConfig ? maskOidcConfig(JSON.parse(created.oidcConfig)) : null,
      samlConfig: created.samlConfig ? JSON.parse(created.samlConfig) : null,
    })
  } catch (error) {
    console.error('Error creating SSO provider:', error)
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
