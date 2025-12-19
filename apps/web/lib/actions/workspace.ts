'use server'

import { z } from 'zod'
import { withAction, mapDomainError } from './with-action'
import { actionOk, actionErr } from './types'
import { getWorkspaceFeatures } from '@/lib/features/server'
import { workspaceService, type BrandingConfig } from '@quackback/domain'
import { workspaceIdSchema, generateId, type SsoProviderId } from '@quackback/ids'
import { db, ssoProvider, eq, and } from '@/lib/db'
import { createSsoProviderSchema } from '@/lib/schemas/sso-providers'

// ============================================
// Schemas
// ============================================

const getWorkspaceFeaturesSchema = z.object({
  workspaceId: workspaceIdSchema,
})

const getPortalConfigSchema = z.object({
  workspaceId: workspaceIdSchema,
})

const updatePortalConfigSchema = z.object({
  workspaceId: workspaceIdSchema,
  oauth: z
    .object({
      google: z.boolean().optional(),
      github: z.boolean().optional(),
    })
    .optional(),
  features: z
    .object({
      publicView: z.boolean().optional(),
      submissions: z.boolean().optional(),
      comments: z.boolean().optional(),
      voting: z.boolean().optional(),
    })
    .optional(),
})

const getThemeSchema = z.object({
  workspaceId: workspaceIdSchema,
})

const updateThemeSchema = z.object({
  workspaceId: workspaceIdSchema,
  brandingConfig: z.record(z.string(), z.unknown()),
})

const getCustomCssSchema = z.object({
  workspaceId: workspaceIdSchema,
})

const updateCustomCssSchema = z.object({
  workspaceId: workspaceIdSchema,
  customCss: z.string().nullable(),
})

const getSecuritySchema = z.object({
  workspaceId: workspaceIdSchema,
})

const updateSecuritySchema = z.object({
  workspaceId: workspaceIdSchema,
  oauth: z
    .object({
      google: z.boolean().optional(),
      github: z.boolean().optional(),
      microsoft: z.boolean().optional(),
    })
    .optional(),
  ssoRequired: z.boolean().optional(),
  openSignup: z.boolean().optional(),
})

// ============================================
// Type Exports
// ============================================

export type GetWorkspaceFeaturesInput = z.infer<typeof getWorkspaceFeaturesSchema>
export type GetPortalConfigInput = z.infer<typeof getPortalConfigSchema>
export type UpdatePortalConfigInput = z.infer<typeof updatePortalConfigSchema>
export type GetThemeInput = z.infer<typeof getThemeSchema>
export type UpdateThemeInput = z.infer<typeof updateThemeSchema>
export type GetCustomCssInput = z.infer<typeof getCustomCssSchema>
export type UpdateCustomCssInput = z.infer<typeof updateCustomCssSchema>
export type GetSecurityInput = z.infer<typeof getSecuritySchema>
export type UpdateSecurityInput = z.infer<typeof updateSecuritySchema>

// ============================================
// Actions
// ============================================

/**
 * Get workspace feature access info.
 */
export const getWorkspaceFeaturesAction = withAction(
  getWorkspaceFeaturesSchema,
  async (_input, ctx) => {
    const features = await getWorkspaceFeatures(ctx.workspace.id)
    return actionOk({
      edition: features.edition,
      tier: features.tier,
      enabledFeatures: features.enabledFeatures,
      limits: features.limits,
    })
  }
)

/**
 * Get portal configuration.
 */
export const getPortalConfigAction = withAction(
  getPortalConfigSchema,
  async (_input, ctx) => {
    const result = await workspaceService.getPortalConfig(ctx.workspace.id)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({
      oauth: result.value.oauth,
      features: result.value.features,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update portal configuration.
 */
export const updatePortalConfigAction = withAction(
  updatePortalConfigSchema,
  async (input, _ctx, serviceCtx) => {
    const updateInput: {
      oauth?: { google?: boolean; github?: boolean }
      features?: {
        publicView?: boolean
        submissions?: boolean
        comments?: boolean
        voting?: boolean
      }
    } = {}

    if (input.oauth) {
      updateInput.oauth = {}
      if (typeof input.oauth.google === 'boolean') updateInput.oauth.google = input.oauth.google
      if (typeof input.oauth.github === 'boolean') updateInput.oauth.github = input.oauth.github
    }

    if (input.features) {
      updateInput.features = {}
      if (typeof input.features.publicView === 'boolean')
        updateInput.features.publicView = input.features.publicView
      if (typeof input.features.submissions === 'boolean')
        updateInput.features.submissions = input.features.submissions
      if (typeof input.features.comments === 'boolean')
        updateInput.features.comments = input.features.comments
      if (typeof input.features.voting === 'boolean')
        updateInput.features.voting = input.features.voting
    }

    if (Object.keys(updateInput).length === 0) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: 'At least one setting must be provided',
        status: 400,
      })
    }

    const result = await workspaceService.updatePortalConfig(updateInput, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    return actionOk({
      oauth: result.value.oauth,
      features: result.value.features,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Get branding/theme configuration.
 */
export const getThemeAction = withAction(
  getThemeSchema,
  async (_input, ctx) => {
    const result = await workspaceService.getBrandingConfig(ctx.workspace.id)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ brandingConfig: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update branding/theme configuration.
 */
export const updateThemeAction = withAction(
  updateThemeSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await workspaceService.updateBrandingConfig(
      (input.brandingConfig || {}) as BrandingConfig,
      serviceCtx
    )
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ brandingConfig: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Get custom CSS.
 */
export const getCustomCssAction = withAction(
  getCustomCssSchema,
  async (_input, ctx) => {
    const result = await workspaceService.getCustomCss(ctx.workspace.id)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ customCss: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update custom CSS.
 */
export const updateCustomCssAction = withAction(
  updateCustomCssSchema,
  async (input, _ctx, serviceCtx) => {
    const result = await workspaceService.updateCustomCss(input.customCss, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({ customCss: result.value })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Get security/auth configuration.
 */
export const getSecurityAction = withAction(
  getSecuritySchema,
  async (_input, ctx) => {
    const result = await workspaceService.getAuthConfig(ctx.workspace.id)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }
    return actionOk({
      oauth: result.value.oauth,
      ssoRequired: result.value.ssoRequired,
      openSignup: result.value.openSignup,
    })
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Update security/auth configuration.
 */
export const updateSecurityAction = withAction(
  updateSecuritySchema,
  async (input, _ctx, serviceCtx) => {
    const updateInput: {
      oauth?: { google?: boolean; github?: boolean; microsoft?: boolean }
      ssoRequired?: boolean
      openSignup?: boolean
    } = {}

    if (input.oauth) {
      updateInput.oauth = {}
      if (typeof input.oauth.google === 'boolean') updateInput.oauth.google = input.oauth.google
      if (typeof input.oauth.github === 'boolean') updateInput.oauth.github = input.oauth.github
      if (typeof input.oauth.microsoft === 'boolean')
        updateInput.oauth.microsoft = input.oauth.microsoft
    }
    if (typeof input.ssoRequired === 'boolean') {
      updateInput.ssoRequired = input.ssoRequired
    }
    if (typeof input.openSignup === 'boolean') {
      updateInput.openSignup = input.openSignup
    }

    if (Object.keys(updateInput).length === 0) {
      return actionErr({
        code: 'VALIDATION_ERROR',
        message: 'At least one setting must be provided',
        status: 400,
      })
    }

    const result = await workspaceService.updateAuthConfig(updateInput, serviceCtx)
    if (!result.success) {
      return actionErr(mapDomainError(result.error))
    }

    return actionOk({
      oauth: result.value.oauth,
      ssoRequired: result.value.ssoRequired,
      openSignup: result.value.openSignup,
    })
  },
  { roles: ['owner', 'admin'] }
)

// ============================================
// SSO Provider Actions
// ============================================

const createSsoProviderWithWorkspaceSchema = createSsoProviderSchema.and(
  z.object({ workspaceId: workspaceIdSchema })
)

/**
 * Create a new SSO provider.
 */
export const createSsoProviderAction = withAction(
  createSsoProviderWithWorkspaceSchema,
  async (input, ctx) => {
    const { type, issuer, domain, oidcConfig, samlConfig } = input

    // Check if domain is already in use
    const existingProvider = await db.query.ssoProvider.findFirst({
      where: eq(ssoProvider.domain, domain),
    })

    if (existingProvider) {
      return actionErr({
        code: 'CONFLICT',
        message: 'Domain is already associated with an SSO provider',
        status: 409,
      })
    }

    // Generate a unique provider ID
    const providerId = `sso_${ctx.workspace.slug}_${type}_${Date.now()}`

    // Create the SSO provider
    const [created] = await db
      .insert(ssoProvider)
      .values({
        id: generateId('sso_provider'),
        workspaceId: ctx.workspace.id,
        issuer,
        domain,
        providerId,
        oidcConfig: oidcConfig ? JSON.stringify(oidcConfig) : null,
        samlConfig: samlConfig ? JSON.stringify(samlConfig) : null,
      })
      .returning()

    return actionOk({
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

const listSsoProvidersSchema = z.object({
  workspaceId: workspaceIdSchema,
})

const deleteSsoProviderSchema = z.object({
  workspaceId: workspaceIdSchema,
  providerId: z.string(),
})

export type ListSsoProvidersInput = z.infer<typeof listSsoProvidersSchema>
export type DeleteSsoProviderInput = z.infer<typeof deleteSsoProviderSchema>

/**
 * List all SSO providers for a workspace.
 */
export const listSsoProvidersAction = withAction(
  listSsoProvidersSchema,
  async (_input, ctx) => {
    const providers = await db.query.ssoProvider.findMany({
      where: eq(ssoProvider.workspaceId, ctx.workspace.id),
      orderBy: (ssoProvider, { desc }) => [desc(ssoProvider.createdAt)],
    })

    return actionOk(
      providers.map((p) => ({
        ...p,
        oidcConfig: p.oidcConfig ? maskOidcConfig(JSON.parse(p.oidcConfig)) : null,
        samlConfig: p.samlConfig ? JSON.parse(p.samlConfig) : null,
      }))
    )
  },
  { roles: ['owner', 'admin'] }
)

/**
 * Delete an SSO provider.
 */
export const deleteSsoProviderAction = withAction(
  deleteSsoProviderSchema,
  async (input, ctx) => {
    const providerId = input.providerId as SsoProviderId

    // Verify the provider belongs to this workspace
    const existingProvider = await db.query.ssoProvider.findFirst({
      where: and(eq(ssoProvider.id, providerId), eq(ssoProvider.workspaceId, ctx.workspace.id)),
    })

    if (!existingProvider) {
      return actionErr({
        code: 'NOT_FOUND',
        message: 'SSO provider not found',
        status: 404,
      })
    }

    await db.delete(ssoProvider).where(eq(ssoProvider.id, providerId))

    return actionOk({ success: true })
  },
  { roles: ['owner', 'admin'] }
)
