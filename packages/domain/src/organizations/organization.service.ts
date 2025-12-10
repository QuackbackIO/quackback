/**
 * OrganizationService - Business logic for organization settings
 *
 * This service handles all organization-related business logic including:
 * - Security settings (auth methods, SSO mode)
 * - Portal authentication settings
 * - Theme configuration
 * - SSO provider management
 * - Public permission checking
 */

import { db, eq, and, desc, organization, ssoProvider, member } from '@quackback/db'
import type { PermissionLevel } from '@quackback/db/types'
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { OrgError } from './organization.errors'
import type {
  SecuritySettings,
  UpdateSecurityInput,
  PortalAuthSettings,
  UpdatePortalAuthInput,
  ThemeConfig,
  SsoProviderResponse,
  CreateSsoProviderInput,
  UpdateSsoProviderInput,
  PublicAuthConfig,
  PortalPublicAuthConfig,
  SsoCheckResult,
  InteractionPermission,
  OidcConfig,
  SamlConfig,
} from './organization.types'

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
 * Parse JSON config from database string
 */
function parseJsonConfig<T>(json: string | null): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

/**
 * Service class for organization domain operations
 */
export class OrganizationService {
  // ============================================
  // SECURITY SETTINGS
  // ============================================

  /**
   * Get security settings for an organization
   * Public method - no auth required
   */
  async getSecuritySettings(organizationId: string): Promise<Result<SecuritySettings, OrgError>> {
    try {
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
      })

      if (!org) {
        return err(OrgError.notFound(organizationId))
      }

      return ok({
        passwordAuthEnabled: org.passwordAuthEnabled,
        googleOAuthEnabled: org.googleOAuthEnabled,
        githubOAuthEnabled: org.githubOAuthEnabled,
        microsoftOAuthEnabled: org.microsoftOAuthEnabled,
      })
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to fetch security settings: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update security settings for an organization
   * Requires owner or admin role
   */
  async updateSecuritySettings(
    input: UpdateSecurityInput,
    ctx: ServiceContext
  ): Promise<Result<SecuritySettings, OrgError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(OrgError.unauthorized('update security settings'))
    }

    try {
      // Build update object with only provided fields
      const updates: Partial<typeof organization.$inferInsert> = {}
      if (input.passwordAuthEnabled !== undefined)
        updates.passwordAuthEnabled = input.passwordAuthEnabled
      if (input.googleOAuthEnabled !== undefined)
        updates.googleOAuthEnabled = input.googleOAuthEnabled
      if (input.githubOAuthEnabled !== undefined)
        updates.githubOAuthEnabled = input.githubOAuthEnabled
      if (input.microsoftOAuthEnabled !== undefined)
        updates.microsoftOAuthEnabled = input.microsoftOAuthEnabled

      if (Object.keys(updates).length === 0) {
        return err(OrgError.validationError('No fields provided to update'))
      }

      const [updated] = await db
        .update(organization)
        .set(updates)
        .where(eq(organization.id, ctx.organizationId))
        .returning()

      if (!updated) {
        return err(OrgError.notFound(ctx.organizationId))
      }

      return ok({
        passwordAuthEnabled: updated.passwordAuthEnabled,
        googleOAuthEnabled: updated.googleOAuthEnabled,
        githubOAuthEnabled: updated.githubOAuthEnabled,
        microsoftOAuthEnabled: updated.microsoftOAuthEnabled,
      })
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to update security settings: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // PORTAL AUTH SETTINGS
  // ============================================

  /**
   * Get portal authentication settings for an organization
   * Public method - no auth required
   */
  async getPortalAuthSettings(
    organizationId: string
  ): Promise<Result<PortalAuthSettings, OrgError>> {
    try {
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
      })

      if (!org) {
        return err(OrgError.notFound(organizationId))
      }

      return ok({
        portalAuthEnabled: org.portalAuthEnabled,
        portalPasswordEnabled: org.portalPasswordEnabled,
        portalGoogleEnabled: org.portalGoogleEnabled,
        portalGithubEnabled: org.portalGithubEnabled,
        portalVoting: org.portalVoting as PermissionLevel,
        portalCommenting: org.portalCommenting as PermissionLevel,
        portalSubmissions: org.portalSubmissions as PermissionLevel,
      })
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to fetch portal auth settings: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update portal authentication settings for an organization
   * Requires owner or admin role
   */
  async updatePortalAuthSettings(
    input: UpdatePortalAuthInput,
    ctx: ServiceContext
  ): Promise<Result<PortalAuthSettings, OrgError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(OrgError.unauthorized('update portal auth settings'))
    }

    try {
      // Build update object with only provided fields
      const updates: Partial<typeof organization.$inferInsert> = {}
      if (input.portalAuthEnabled !== undefined) updates.portalAuthEnabled = input.portalAuthEnabled
      if (input.portalPasswordEnabled !== undefined)
        updates.portalPasswordEnabled = input.portalPasswordEnabled
      if (input.portalGoogleEnabled !== undefined)
        updates.portalGoogleEnabled = input.portalGoogleEnabled
      if (input.portalGithubEnabled !== undefined)
        updates.portalGithubEnabled = input.portalGithubEnabled
      if (input.portalVoting !== undefined) updates.portalVoting = input.portalVoting
      if (input.portalCommenting !== undefined) updates.portalCommenting = input.portalCommenting
      if (input.portalSubmissions !== undefined) updates.portalSubmissions = input.portalSubmissions

      if (Object.keys(updates).length === 0) {
        return err(OrgError.validationError('No fields provided to update'))
      }

      const [updated] = await db
        .update(organization)
        .set(updates)
        .where(eq(organization.id, ctx.organizationId))
        .returning()

      if (!updated) {
        return err(OrgError.notFound(ctx.organizationId))
      }

      return ok({
        portalAuthEnabled: updated.portalAuthEnabled,
        portalPasswordEnabled: updated.portalPasswordEnabled,
        portalGoogleEnabled: updated.portalGoogleEnabled,
        portalGithubEnabled: updated.portalGithubEnabled,
        portalVoting: updated.portalVoting as PermissionLevel,
        portalCommenting: updated.portalCommenting as PermissionLevel,
        portalSubmissions: updated.portalSubmissions as PermissionLevel,
      })
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to update portal auth settings: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // THEME SETTINGS
  // ============================================

  /**
   * Get theme configuration for an organization
   * Public method - no auth required
   */
  async getTheme(organizationId: string): Promise<Result<ThemeConfig, OrgError>> {
    try {
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
      })

      if (!org) {
        return err(OrgError.notFound(organizationId))
      }

      const themeConfig = parseJsonConfig<ThemeConfig>(org.themeConfig) || {}
      return ok(themeConfig)
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to fetch theme: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update theme configuration for an organization
   * Requires owner or admin role
   */
  async updateTheme(
    themeConfig: ThemeConfig,
    ctx: ServiceContext
  ): Promise<Result<ThemeConfig, OrgError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(OrgError.unauthorized('update theme'))
    }

    try {
      const serialized = JSON.stringify(themeConfig)

      const [updated] = await db
        .update(organization)
        .set({ themeConfig: serialized })
        .where(eq(organization.id, ctx.organizationId))
        .returning()

      if (!updated) {
        return err(OrgError.notFound(ctx.organizationId))
      }

      return ok(themeConfig)
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to update theme: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // SSO PROVIDER MANAGEMENT
  // ============================================

  /**
   * List all SSO providers for an organization
   * Requires owner or admin role
   */
  async listSsoProviders(ctx: ServiceContext): Promise<Result<SsoProviderResponse[], OrgError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(OrgError.unauthorized('list SSO providers'))
    }

    try {
      const providers = await db.query.ssoProvider.findMany({
        where: eq(ssoProvider.organizationId, ctx.organizationId),
        orderBy: desc(ssoProvider.createdAt),
      })

      const response: SsoProviderResponse[] = providers.map((p) => ({
        id: p.id,
        organizationId: p.organizationId,
        providerId: p.providerId,
        issuer: p.issuer,
        domain: p.domain,
        oidcConfig: maskOidcConfig(parseJsonConfig<OidcConfig>(p.oidcConfig)),
        samlConfig: parseJsonConfig<SamlConfig>(p.samlConfig),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }))

      return ok(response)
    } catch (error) {
      return err(
        OrgError.validationError(
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
    providerId: string,
    ctx: ServiceContext
  ): Promise<Result<SsoProviderResponse, OrgError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(OrgError.unauthorized('view SSO provider'))
    }

    try {
      const provider = await db.query.ssoProvider.findFirst({
        where: and(
          eq(ssoProvider.id, providerId),
          eq(ssoProvider.organizationId, ctx.organizationId)
        ),
      })

      if (!provider) {
        return err(OrgError.ssoProviderNotFound(providerId))
      }

      return ok({
        id: provider.id,
        organizationId: provider.organizationId,
        providerId: provider.providerId,
        issuer: provider.issuer,
        domain: provider.domain,
        oidcConfig: maskOidcConfig(parseJsonConfig<OidcConfig>(provider.oidcConfig)),
        samlConfig: parseJsonConfig<SamlConfig>(provider.samlConfig),
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      })
    } catch (error) {
      return err(
        OrgError.validationError(
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
  ): Promise<Result<SsoProviderResponse, OrgError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(OrgError.unauthorized('create SSO provider'))
    }

    // Validate domain format
    const domainRegex = /^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/
    if (!domainRegex.test(input.domain.toLowerCase())) {
      return err(OrgError.validationError('Invalid domain format'))
    }

    try {
      // Check for duplicate domain
      const existingDomain = await db.query.ssoProvider.findFirst({
        where: eq(ssoProvider.domain, input.domain.toLowerCase()),
      })

      if (existingDomain) {
        return err(OrgError.duplicateDomain(input.domain))
      }

      const providerId = generateProviderId()
      const id = crypto.randomUUID()

      const [created] = await db
        .insert(ssoProvider)
        .values({
          id,
          organizationId: ctx.organizationId,
          providerId,
          issuer: input.issuer,
          domain: input.domain.toLowerCase(),
          oidcConfig: input.oidcConfig ? JSON.stringify(input.oidcConfig) : null,
          samlConfig: input.samlConfig ? JSON.stringify(input.samlConfig) : null,
        })
        .returning()

      return ok({
        id: created.id,
        organizationId: created.organizationId,
        providerId: created.providerId,
        issuer: created.issuer,
        domain: created.domain,
        oidcConfig: maskOidcConfig(parseJsonConfig<OidcConfig>(created.oidcConfig)),
        samlConfig: parseJsonConfig<SamlConfig>(created.samlConfig),
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      })
    } catch (error) {
      return err(
        OrgError.validationError(
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
    providerId: string,
    input: UpdateSsoProviderInput,
    ctx: ServiceContext
  ): Promise<Result<SsoProviderResponse, OrgError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(OrgError.unauthorized('update SSO provider'))
    }

    try {
      // Get existing provider
      const existing = await db.query.ssoProvider.findFirst({
        where: and(
          eq(ssoProvider.id, providerId),
          eq(ssoProvider.organizationId, ctx.organizationId)
        ),
      })

      if (!existing) {
        return err(OrgError.ssoProviderNotFound(providerId))
      }

      // Check domain uniqueness if changing
      if (input.domain && input.domain.toLowerCase() !== existing.domain) {
        const domainRegex = /^[a-z0-9]+([-.][a-z0-9]+)*\.[a-z]{2,}$/
        if (!domainRegex.test(input.domain.toLowerCase())) {
          return err(OrgError.validationError('Invalid domain format'))
        }

        const existingDomain = await db.query.ssoProvider.findFirst({
          where: eq(ssoProvider.domain, input.domain.toLowerCase()),
        })

        if (existingDomain) {
          return err(OrgError.duplicateDomain(input.domain))
        }
      }

      // Build update object
      const updates: Partial<typeof ssoProvider.$inferInsert> = {}
      if (input.issuer !== undefined) updates.issuer = input.issuer
      if (input.domain !== undefined) updates.domain = input.domain.toLowerCase()

      // Merge OIDC config
      if (input.oidcConfig !== undefined) {
        const existingOidc = parseJsonConfig<OidcConfig>(existing.oidcConfig)
        const mergedOidc = existingOidc
          ? { ...existingOidc, ...input.oidcConfig }
          : input.oidcConfig
        updates.oidcConfig = JSON.stringify(mergedOidc)
      }

      // Merge SAML config
      if (input.samlConfig !== undefined) {
        const existingSaml = parseJsonConfig<SamlConfig>(existing.samlConfig)
        const mergedSaml = existingSaml
          ? { ...existingSaml, ...input.samlConfig }
          : input.samlConfig
        updates.samlConfig = JSON.stringify(mergedSaml)
      }

      if (Object.keys(updates).length === 0) {
        return err(OrgError.validationError('No fields provided to update'))
      }

      const [updated] = await db
        .update(ssoProvider)
        .set(updates)
        .where(eq(ssoProvider.id, providerId))
        .returning()

      return ok({
        id: updated.id,
        organizationId: updated.organizationId,
        providerId: updated.providerId,
        issuer: updated.issuer,
        domain: updated.domain,
        oidcConfig: maskOidcConfig(parseJsonConfig<OidcConfig>(updated.oidcConfig)),
        samlConfig: parseJsonConfig<SamlConfig>(updated.samlConfig),
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      })
    } catch (error) {
      return err(
        OrgError.validationError(
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
    providerId: string,
    ctx: ServiceContext
  ): Promise<Result<void, OrgError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(OrgError.unauthorized('delete SSO provider'))
    }

    try {
      // Verify provider exists and belongs to org
      const existing = await db.query.ssoProvider.findFirst({
        where: and(
          eq(ssoProvider.id, providerId),
          eq(ssoProvider.organizationId, ctx.organizationId)
        ),
      })

      if (!existing) {
        return err(OrgError.ssoProviderNotFound(providerId))
      }

      await db.delete(ssoProvider).where(eq(ssoProvider.id, providerId))

      return ok(undefined)
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to delete SSO provider: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // PUBLIC AUTH CONFIG (NO AUTH REQUIRED)
  // ============================================

  /**
   * Get public auth configuration for login forms
   * No authentication required - returns only non-sensitive information
   */
  async getPublicAuthConfig(organizationSlug: string): Promise<Result<PublicAuthConfig, OrgError>> {
    try {
      const org = await db.query.organization.findFirst({
        where: eq(organization.slug, organizationSlug),
      })

      if (!org) {
        return err(OrgError.notFound())
      }

      // Get SSO providers (without secrets)
      const providers = await db.query.ssoProvider.findMany({
        where: eq(ssoProvider.organizationId, org.id),
      })

      return ok({
        passwordEnabled: org.passwordAuthEnabled,
        googleEnabled: org.googleOAuthEnabled,
        githubEnabled: org.githubOAuthEnabled,
        microsoftEnabled: org.microsoftOAuthEnabled,
        openSignupEnabled: org.openSignupEnabled,
        ssoProviders: providers.map((p) => ({
          providerId: p.providerId,
          issuer: p.issuer,
          domain: p.domain,
        })),
      })
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to fetch public auth config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Get portal public auth configuration
   * No authentication required - returns only non-sensitive information
   */
  async getPortalPublicAuthConfig(
    organizationSlug: string
  ): Promise<Result<PortalPublicAuthConfig, OrgError>> {
    try {
      const org = await db.query.organization.findFirst({
        where: eq(organization.slug, organizationSlug),
      })

      if (!org) {
        return err(OrgError.notFound())
      }

      return ok({
        portalAuthEnabled: org.portalAuthEnabled,
        passwordEnabled: org.portalPasswordEnabled,
        googleEnabled: org.portalGoogleEnabled,
        githubEnabled: org.portalGithubEnabled,
        voting: org.portalVoting as PermissionLevel,
        commenting: org.portalCommenting as PermissionLevel,
        submissions: org.portalSubmissions as PermissionLevel,
      })
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to fetch portal auth config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Check if an email domain has SSO configured
   * No authentication required
   */
  async checkSsoByDomain(email: string): Promise<Result<SsoCheckResult | null, OrgError>> {
    try {
      // Extract domain from email
      const atIndex = email.lastIndexOf('@')
      if (atIndex === -1) {
        return err(OrgError.validationError('Invalid email address'))
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
        OrgError.validationError(
          `Failed to check SSO: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // PUBLIC PERMISSION CHECKING
  // ============================================

  /**
   * Check interaction permission for an organization
   * Used by public vote/comment/submit API routes
   */
  async checkInteractionPermission(
    organizationId: string,
    interaction: 'voting' | 'commenting' | 'submissions',
    userId?: string
  ): Promise<Result<InteractionPermission, OrgError>> {
    try {
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, organizationId),
      })

      if (!org) {
        return err(OrgError.notFound(organizationId))
      }

      // Check if user is a member
      let isMember = false
      let memberRecord: { id: string; role: string } | undefined

      if (userId) {
        const foundMember = await db.query.member.findFirst({
          where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
        })

        if (foundMember) {
          isMember = true
          memberRecord = { id: foundMember.id, role: foundMember.role }
        }
      }

      // Get the permission level for the requested interaction
      const permissionMap = {
        voting: org.portalVoting,
        commenting: org.portalCommenting,
        submissions: org.portalSubmissions,
      }

      return ok({
        permission: permissionMap[interaction] as PermissionLevel,
        isMember,
        member: memberRecord,
      })
    } catch (error) {
      return err(
        OrgError.validationError(
          `Failed to check ${interaction} permission: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }
}

/**
 * Singleton instance of OrganizationService
 */
export const organizationService = new OrganizationService()
