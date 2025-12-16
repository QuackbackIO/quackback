import { NextResponse } from 'next/server'
import { db, ssoProvider, eq } from '@/lib/db'
import { withApiHandler, ApiError, validateBody, successResponse } from '@/lib/api-handler'
import { createSsoProviderSchema } from '@/lib/schemas/sso-providers'
import { generateId } from '@quackback/ids'

/**
 * GET /api/organization/sso-providers
 * List all SSO providers for an organization
 */
export const GET = withApiHandler(
  async (_request, { validation }) => {
    // Fetch SSO providers for this organization
    const providers = await db.query.ssoProvider.findMany({
      where: eq(ssoProvider.organizationId, validation.organization.id),
      orderBy: (ssoProvider, { desc }) => [desc(ssoProvider.createdAt)],
    })

    // Parse JSON configs and mask secrets (IDs are already TypeIDs from schema)
    const safeProviders = providers.map((provider) => ({
      ...provider,
      oidcConfig: provider.oidcConfig ? maskOidcConfig(JSON.parse(provider.oidcConfig)) : null,
      samlConfig: provider.samlConfig ? JSON.parse(provider.samlConfig) : null,
    }))

    return NextResponse.json(safeProviders)
  },
  { roles: ['owner', 'admin'] }
)

/**
 * POST /api/organization/sso-providers
 * Create a new SSO provider
 */
export const POST = withApiHandler(
  async (request, { validation }) => {
    const body = await request.json()
    const { type, issuer, domain, oidcConfig, samlConfig } = validateBody(
      createSsoProviderSchema,
      body
    )

    // Check if domain is already in use
    const existingProvider = await db.query.ssoProvider.findFirst({
      where: eq(ssoProvider.domain, domain),
    })

    if (existingProvider) {
      throw new ApiError('Domain is already associated with an SSO provider', 409)
    }

    // Generate a unique provider ID
    const providerId = `sso_${validation.organization.slug}_${type}_${Date.now()}`

    // Create the SSO provider
    const [created] = await db
      .insert(ssoProvider)
      .values({
        id: generateId('sso_provider'),
        organizationId: validation.organization.id,
        issuer,
        domain,
        providerId,
        oidcConfig: oidcConfig ? JSON.stringify(oidcConfig) : null,
        samlConfig: samlConfig ? JSON.stringify(samlConfig) : null,
      })
      .returning()

    // IDs are already TypeIDs from schema
    return successResponse({
      ...created,
      oidcConfig: created.oidcConfig ? maskOidcConfig(JSON.parse(created.oidcConfig)) : null,
      samlConfig: created.samlConfig ? JSON.parse(created.samlConfig) : null,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Mask sensitive fields in OIDC config for safe display
 */
function maskOidcConfig(config: Record<string, unknown>) {
  return {
    ...config,
    clientSecret: config.clientSecret ? '••••••••' : undefined,
  }
}
