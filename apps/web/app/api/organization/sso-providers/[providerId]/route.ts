import { NextResponse } from 'next/server'
import { db, ssoProvider, eq, and } from '@quackback/db'
import { withApiHandlerParams, ApiError, validateBody, successResponse } from '@/lib/api-handler'
import { updateSsoProviderSchema } from '@/lib/schemas/sso-providers'

type RouteParams = { providerId: string }

/**
 * PATCH /api/organization/sso-providers/[providerId]
 * Update an SSO provider
 */
export const PATCH = withApiHandlerParams<RouteParams>(
  async (request, { validation, params }) => {
    const { providerId } = params
    const body = await request.json()
    const updateData = validateBody(updateSsoProviderSchema, body)

    // Find the existing provider
    const existingProvider = await db.query.ssoProvider.findFirst({
      where: and(
        eq(ssoProvider.id, providerId),
        eq(ssoProvider.organizationId, validation.organization.id)
      ),
    })

    if (!existingProvider) {
      throw new ApiError('SSO provider not found', 404)
    }

    // Check if domain is being changed and if it's already in use
    if (updateData.domain && updateData.domain !== existingProvider.domain) {
      const domainInUse = await db.query.ssoProvider.findFirst({
        where: eq(ssoProvider.domain, updateData.domain),
      })

      if (domainInUse) {
        throw new ApiError('Domain is already associated with an SSO provider', 409)
      }
    }

    // Build update object
    const updates: Record<string, unknown> = {}

    if (updateData.issuer) updates.issuer = updateData.issuer
    if (updateData.domain) updates.domain = updateData.domain
    if (updateData.oidcConfig) {
      // Merge with existing config to preserve fields not being updated
      const existingOidc = existingProvider.oidcConfig
        ? JSON.parse(existingProvider.oidcConfig)
        : {}
      updates.oidcConfig = JSON.stringify({
        ...existingOidc,
        ...updateData.oidcConfig,
      })
    }
    if (updateData.samlConfig) {
      const existingSaml = existingProvider.samlConfig
        ? JSON.parse(existingProvider.samlConfig)
        : {}
      updates.samlConfig = JSON.stringify({
        ...existingSaml,
        ...updateData.samlConfig,
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
  },
  { roles: ['owner', 'admin'] }
)

/**
 * DELETE /api/organization/sso-providers/[providerId]
 * Delete an SSO provider
 */
export const DELETE = withApiHandlerParams<RouteParams>(
  async (_request, { validation, params }) => {
    const { providerId } = params

    // Find the existing provider
    const existingProvider = await db.query.ssoProvider.findFirst({
      where: and(
        eq(ssoProvider.id, providerId),
        eq(ssoProvider.organizationId, validation.organization.id)
      ),
    })

    if (!existingProvider) {
      throw new ApiError('SSO provider not found', 404)
    }

    // Delete the provider
    await db.delete(ssoProvider).where(eq(ssoProvider.id, providerId))

    return successResponse({ success: true })
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
