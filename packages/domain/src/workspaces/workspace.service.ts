/**
 * WorkspaceService - Business logic for workspace settings
 *
 * This service handles all workspace-related business logic including:
 * - Auth configuration (team sign-in settings)
 * - Portal configuration (public portal settings)
 * - Branding configuration (theme/colors)
 * - SSO provider management
 */

import { db, eq, and, desc, workspace, ssoProvider } from '@quackback/db'
import { generateId, type WorkspaceId, type SsoProviderId } from '@quackback/ids'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { WorkspaceError } from './workspace.errors'
import type {
  AuthConfig,
  UpdateAuthConfigInput,
  PortalConfig,
  UpdatePortalConfigInput,
  BrandingConfig,
  SsoProviderResponse,
  CreateSsoProviderInput,
  UpdateSsoProviderInput,
  PublicAuthConfig,
  PublicPortalConfig,
  SsoCheckResult,
  OidcConfig,
  SamlConfig,
} from './workspace.types'
import { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from './workspace.types'

/**
 * Generate a unique provider ID for SSO providers
 */
function generateProviderId(): string {
  return `sso_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/**
 * Mask OIDC client secret in responses
 */
function maskOidcConfig(
  config: OidcConfig | null
): (Omit<OidcConfig, 'clientSecret'> & { clientSecret: string }) | null {
  if (!config) return null
  return {
    ...config,
    clientSecret: '••••••••',
  }
}

/**
 * Parse JSON config from database string with default fallback
 */
function parseJsonConfig<T>(json: string | null, defaultValue: T): T {
  if (!json) return defaultValue
  try {
    return { ...defaultValue, ...JSON.parse(json) } as T
  } catch {
    return defaultValue
  }
}

/**
 * Parse JSON config from database string (nullable)
 */
function parseJsonConfigNullable<T>(json: string | null): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/**
 * Deep merge two objects (for partial config updates)
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null
      ) {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>
        ) as T[typeof key]
      } else {
        result[key] = source[key] as T[typeof key]
      }
    }
  }
  return result
}

/**
 * Service class for workspace domain operations
 */
export class WorkspaceService {
  // ============================================
  // AUTH CONFIGURATION (Team sign-in)
  // ============================================

  /**
   * Get auth configuration for a workspace
   * Public method - no auth required
   */
  async getAuthConfig(workspaceId: WorkspaceId): Promise<Result<AuthConfig, WorkspaceError>> {
    try {
      const org = await db.query.workspace.findFirst({
        where: eq(workspace.id, workspaceId),
      })

      if (!org) {
        return err(WorkspaceError.notFound(workspaceId))
      }

      const config = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
      return ok(config)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to fetch auth config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update auth configuration for a workspace
   * Requires owner or admin role
   */
  async updateAuthConfig(
    input: UpdateAuthConfigInput,
    ctx: ServiceContext
  ): Promise<Result<AuthConfig, WorkspaceError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(WorkspaceError.unauthorized('update auth config'))
    }

    try {
      // Get existing config
      const org = await db.query.workspace.findFirst({
        where: eq(workspace.id, ctx.workspaceId),
      })

      if (!org) {
        return err(WorkspaceError.notFound(ctx.workspaceId))
      }

      const existing = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)

      // Deep merge the updates
      const updated = deepMerge(existing, input as Partial<AuthConfig>)

      const [result] = await db
        .update(workspace)
        .set({ authConfig: JSON.stringify(updated) })
        .where(eq(workspace.id, ctx.workspaceId))
        .returning()

      if (!result) {
        return err(WorkspaceError.notFound(ctx.workspaceId))
      }

      return ok(updated)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to update auth config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // PORTAL CONFIGURATION
  // ============================================

  /**
   * Get portal configuration for a workspace
   * Public method - no auth required
   */
  async getPortalConfig(workspaceId: WorkspaceId): Promise<Result<PortalConfig, WorkspaceError>> {
    try {
      const org = await db.query.workspace.findFirst({
        where: eq(workspace.id, workspaceId),
      })

      if (!org) {
        return err(WorkspaceError.notFound(workspaceId))
      }

      const config = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
      return ok(config)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to fetch portal config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update portal configuration for a workspace
   * Requires owner or admin role
   */
  async updatePortalConfig(
    input: UpdatePortalConfigInput,
    ctx: ServiceContext
  ): Promise<Result<PortalConfig, WorkspaceError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(WorkspaceError.unauthorized('update portal config'))
    }

    try {
      // Get existing config
      const org = await db.query.workspace.findFirst({
        where: eq(workspace.id, ctx.workspaceId),
      })

      if (!org) {
        return err(WorkspaceError.notFound(ctx.workspaceId))
      }

      const existing = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

      // Deep merge the updates
      const updated = deepMerge(existing, input as Partial<PortalConfig>)

      const [result] = await db
        .update(workspace)
        .set({ portalConfig: JSON.stringify(updated) })
        .where(eq(workspace.id, ctx.workspaceId))
        .returning()

      if (!result) {
        return err(WorkspaceError.notFound(ctx.workspaceId))
      }

      return ok(updated)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to update portal config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // BRANDING CONFIGURATION
  // ============================================

  /**
   * Get branding configuration for a workspace
   * Public method - no auth required
   */
  async getBrandingConfig(
    workspaceId: WorkspaceId
  ): Promise<Result<BrandingConfig, WorkspaceError>> {
    try {
      const org = await db.query.workspace.findFirst({
        where: eq(workspace.id, workspaceId),
      })

      if (!org) {
        return err(WorkspaceError.notFound(workspaceId))
      }

      const config = parseJsonConfigNullable<BrandingConfig>(org.brandingConfig) || {}
      return ok(config)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to fetch branding config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update branding configuration for a workspace
   * Requires owner or admin role
   */
  async updateBrandingConfig(
    config: BrandingConfig,
    ctx: ServiceContext
  ): Promise<Result<BrandingConfig, WorkspaceError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(WorkspaceError.unauthorized('update branding config'))
    }

    try {
      const [updated] = await db
        .update(workspace)
        .set({ brandingConfig: JSON.stringify(config) })
        .where(eq(workspace.id, ctx.workspaceId))
        .returning()

      if (!updated) {
        return err(WorkspaceError.notFound(ctx.workspaceId))
      }

      return ok(config)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to update branding config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // CUSTOM CSS
  // ============================================

  /**
   * Get custom CSS for a workspace
   * Public method - no auth required
   */
  async getCustomCss(workspaceId: WorkspaceId): Promise<Result<string | null, WorkspaceError>> {
    try {
      const org = await db.query.workspace.findFirst({
        where: eq(workspace.id, workspaceId),
        columns: { customCss: true },
      })

      if (!org) {
        return err(WorkspaceError.notFound(workspaceId))
      }

      return ok(org.customCss)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to fetch custom CSS: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update custom CSS for a workspace
   * Requires owner or admin role
   */
  async updateCustomCss(
    css: string | null,
    ctx: ServiceContext
  ): Promise<Result<string | null, WorkspaceError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(WorkspaceError.unauthorized('update custom CSS'))
    }

    try {
      // Basic sanitization - strip script tags and javascript: URLs
      let sanitized = css
      if (sanitized) {
        sanitized =
          sanitized
            .replace(/<script\b[^>]*>/gi, '')
            .replace(/<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/expression\s*\(/gi, '')
            .trim() || null
      }

      const [updated] = await db
        .update(workspace)
        .set({ customCss: sanitized })
        .where(eq(workspace.id, ctx.workspaceId))
        .returning({ customCss: workspace.customCss })

      if (!updated) {
        return err(WorkspaceError.notFound(ctx.workspaceId))
      }

      return ok(updated.customCss)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to update custom CSS: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // SSO PROVIDER MANAGEMENT
  // ============================================

  /**
   * List all SSO providers for a workspace
   * Requires owner or admin role
   */
  async listSsoProviders(
    ctx: ServiceContext
  ): Promise<Result<SsoProviderResponse[], WorkspaceError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(WorkspaceError.unauthorized('list SSO providers'))
    }

    try {
      const providers = await db.query.ssoProvider.findMany({
        where: eq(ssoProvider.workspaceId, ctx.workspaceId),
        orderBy: desc(ssoProvider.createdAt),
      })

      const response: SsoProviderResponse[] = providers.map((p) => ({
        id: p.id,
        workspaceId: p.workspaceId,
        providerId: p.providerId,
        issuer: p.issuer,
        domain: p.domain,
        oidcConfig: maskOidcConfig(parseJsonConfigNullable<OidcConfig>(p.oidcConfig)),
        samlConfig: parseJsonConfigNullable<SamlConfig>(p.samlConfig),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }))

      return ok(response)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to list SSO providers: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Get a single SSO provider by ID
   * Requires owner or admin role
   */
  async getSsoProvider(
    providerId: SsoProviderId,
    ctx: ServiceContext
  ): Promise<Result<SsoProviderResponse, WorkspaceError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(WorkspaceError.unauthorized('view SSO provider'))
    }

    try {
      const provider = await db.query.ssoProvider.findFirst({
        where: and(eq(ssoProvider.id, providerId), eq(ssoProvider.workspaceId, ctx.workspaceId)),
      })

      if (!provider) {
        return err(WorkspaceError.ssoProviderNotFound(providerId))
      }

      return ok({
        id: provider.id,
        workspaceId: provider.workspaceId,
        providerId: provider.providerId,
        issuer: provider.issuer,
        domain: provider.domain,
        oidcConfig: maskOidcConfig(parseJsonConfigNullable<OidcConfig>(provider.oidcConfig)),
        samlConfig: parseJsonConfigNullable<SamlConfig>(provider.samlConfig),
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      })
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to get SSO provider: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Create a new SSO provider
   * Requires owner or admin role
   */
  async createSsoProvider(
    input: CreateSsoProviderInput,
    ctx: ServiceContext
  ): Promise<Result<SsoProviderResponse, WorkspaceError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(WorkspaceError.unauthorized('create SSO provider'))
    }

    // Validate domain format
    const domainRegex = /^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/
    if (!domainRegex.test(input.domain.toLowerCase())) {
      return err(WorkspaceError.validationError('Invalid domain format'))
    }

    try {
      // Check for duplicate domain within this organization
      const existingDomain = await db.query.ssoProvider.findFirst({
        where: and(
          eq(ssoProvider.workspaceId, ctx.workspaceId),
          eq(ssoProvider.domain, input.domain.toLowerCase())
        ),
      })

      if (existingDomain) {
        return err(WorkspaceError.duplicateDomain(input.domain))
      }

      const providerId = generateProviderId()
      const id = generateId('sso_provider')

      const [created] = await db
        .insert(ssoProvider)
        .values({
          id,
          workspaceId: ctx.workspaceId,
          providerId,
          issuer: input.issuer,
          domain: input.domain.toLowerCase(),
          oidcConfig: input.oidcConfig ? JSON.stringify(input.oidcConfig) : null,
          samlConfig: input.samlConfig ? JSON.stringify(input.samlConfig) : null,
        })
        .returning()

      return ok({
        id: created.id,
        workspaceId: created.workspaceId,
        providerId: created.providerId,
        issuer: created.issuer,
        domain: created.domain,
        oidcConfig: maskOidcConfig(parseJsonConfigNullable<OidcConfig>(created.oidcConfig)),
        samlConfig: parseJsonConfigNullable<SamlConfig>(created.samlConfig),
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      })
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to create SSO provider: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update an SSO provider
   * Requires owner or admin role
   */
  async updateSsoProvider(
    providerId: SsoProviderId,
    input: UpdateSsoProviderInput,
    ctx: ServiceContext
  ): Promise<Result<SsoProviderResponse, WorkspaceError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(WorkspaceError.unauthorized('update SSO provider'))
    }

    try {
      // Get existing provider
      const existing = await db.query.ssoProvider.findFirst({
        where: and(eq(ssoProvider.id, providerId), eq(ssoProvider.workspaceId, ctx.workspaceId)),
      })

      if (!existing) {
        return err(WorkspaceError.ssoProviderNotFound(providerId))
      }

      // Check domain uniqueness within org if changing
      if (input.domain && input.domain.toLowerCase() !== existing.domain) {
        const domainRegex = /^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/
        if (!domainRegex.test(input.domain.toLowerCase())) {
          return err(WorkspaceError.validationError('Invalid domain format'))
        }

        const existingDomain = await db.query.ssoProvider.findFirst({
          where: and(
            eq(ssoProvider.workspaceId, ctx.workspaceId),
            eq(ssoProvider.domain, input.domain.toLowerCase())
          ),
        })

        if (existingDomain) {
          return err(WorkspaceError.duplicateDomain(input.domain))
        }
      }

      // Build update object
      const updates: Partial<typeof ssoProvider.$inferInsert> = {}
      if (input.issuer !== undefined) updates.issuer = input.issuer
      if (input.domain !== undefined) updates.domain = input.domain.toLowerCase()

      // Merge OIDC config
      if (input.oidcConfig !== undefined) {
        const existingOidc = parseJsonConfigNullable<OidcConfig>(existing.oidcConfig)
        const mergedOidc = existingOidc
          ? { ...existingOidc, ...input.oidcConfig }
          : input.oidcConfig
        updates.oidcConfig = JSON.stringify(mergedOidc)
      }

      // Merge SAML config
      if (input.samlConfig !== undefined) {
        const existingSaml = parseJsonConfigNullable<SamlConfig>(existing.samlConfig)
        const mergedSaml = existingSaml
          ? { ...existingSaml, ...input.samlConfig }
          : input.samlConfig
        updates.samlConfig = JSON.stringify(mergedSaml)
      }

      if (Object.keys(updates).length === 0) {
        return err(WorkspaceError.validationError('No fields provided to update'))
      }

      const [updated] = await db
        .update(ssoProvider)
        .set(updates)
        .where(eq(ssoProvider.id, providerId))
        .returning()

      return ok({
        id: updated.id,
        workspaceId: updated.workspaceId,
        providerId: updated.providerId,
        issuer: updated.issuer,
        domain: updated.domain,
        oidcConfig: maskOidcConfig(parseJsonConfigNullable<OidcConfig>(updated.oidcConfig)),
        samlConfig: parseJsonConfigNullable<SamlConfig>(updated.samlConfig),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      })
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to update SSO provider: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Delete an SSO provider
   * Requires owner or admin role
   */
  async deleteSsoProvider(
    providerId: SsoProviderId,
    ctx: ServiceContext
  ): Promise<Result<void, WorkspaceError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(WorkspaceError.unauthorized('delete SSO provider'))
    }

    try {
      // Verify provider exists and belongs to org
      const existing = await db.query.ssoProvider.findFirst({
        where: and(eq(ssoProvider.id, providerId), eq(ssoProvider.workspaceId, ctx.workspaceId)),
      })

      if (!existing) {
        return err(WorkspaceError.ssoProviderNotFound(providerId))
      }

      await db.delete(ssoProvider).where(eq(ssoProvider.id, providerId))

      return ok(undefined)
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to delete SSO provider: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // PUBLIC CONFIG (NO AUTH REQUIRED)
  // ============================================

  /**
   * Get public auth configuration for login forms
   * No authentication required - returns only non-sensitive information
   */
  async getPublicAuthConfig(
    organizationSlug: string
  ): Promise<Result<PublicAuthConfig, WorkspaceError>> {
    try {
      const org = await db.query.workspace.findFirst({
        where: eq(workspace.slug, organizationSlug),
      })

      if (!org) {
        return err(WorkspaceError.notFound())
      }

      const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)

      // Get SSO providers (without secrets)
      const providers = await db.query.ssoProvider.findMany({
        where: eq(ssoProvider.workspaceId, org.id),
      })

      return ok({
        oauth: authConfig.oauth,
        openSignup: authConfig.openSignup,
        ssoProviders: providers.map((p) => ({
          providerId: p.providerId,
          issuer: p.issuer,
          domain: p.domain,
        })),
      })
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to fetch public auth config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Get public portal configuration
   * No authentication required - returns only non-sensitive information
   */
  async getPublicPortalConfig(
    organizationSlug: string
  ): Promise<Result<PublicPortalConfig, WorkspaceError>> {
    try {
      const org = await db.query.workspace.findFirst({
        where: eq(workspace.slug, organizationSlug),
      })

      if (!org) {
        return err(WorkspaceError.notFound())
      }

      const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

      return ok({
        oauth: portalConfig.oauth,
        features: portalConfig.features,
      })
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to fetch portal config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Check if an email domain has SSO configured
   * No authentication required
   */
  async checkSsoByDomain(email: string): Promise<Result<SsoCheckResult | null, WorkspaceError>> {
    try {
      // Extract domain from email
      const atIndex = email.lastIndexOf('@')
      if (atIndex === -1) {
        return err(WorkspaceError.validationError('Invalid email address'))
      }
      const domain = email.slice(atIndex + 1).toLowerCase()

      const provider = await db.query.ssoProvider.findFirst({
        where: eq(ssoProvider.domain, domain),
      })

      if (!provider) {
        return ok(null)
      }

      return ok({
        hasSso: true,
        providerId: provider.providerId,
        issuer: provider.issuer,
        domain: provider.domain,
      })
    } catch (error) {
      return err(
        WorkspaceError.validationError(
          `Failed to check SSO: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }
}

/**
 * Singleton instance of WorkspaceService
 */
export const workspaceService = new WorkspaceService()
