/**
 * SettingsService - Business logic for app settings
 *
 * This service handles all settings-related business logic including:
 * - Auth configuration (team sign-in settings)
 * - Portal configuration (public portal settings)
 * - Branding configuration (theme/colors)
 */

import { db, eq, settings } from '@/lib/db'
import { NotFoundError, InternalError, ValidationError } from '@/lib/shared/errors'
import type {
  AuthConfig,
  UpdateAuthConfigInput,
  PortalConfig,
  UpdatePortalConfigInput,
  BrandingConfig,
  PublicAuthConfig,
  PublicPortalConfig,
  AdminOIDCConfig,
  UpdateOIDCConfigInput,
  OIDCProviderConfig,
  SecurityConfig,
  AdminSecurityConfig,
  PublicSecurityConfig,
  UpdateSecurityConfigInput,
} from './settings.types'
import {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_SECURITY_CONFIG,
} from './settings.types'
import { encryptOIDCSecret, fetchOIDCDiscovery } from '@/lib/auth/oidc.service'

// ============================================
// HELPERS
// ============================================

function parseJsonConfig<T>(json: string | null, defaultValue: T): T {
  if (!json) return defaultValue
  try {
    return { ...defaultValue, ...JSON.parse(json) } as T
  } catch {
    return defaultValue
  }
}

function parseJsonOrNull<T>(json: string | null): T | null {
  if (!json) return null
  try {
    return JSON.parse(json) as T
  } catch {
    return null
  }
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key in source) {
    if (source[key] !== undefined) {
      const srcVal = source[key]
      const tgtVal = result[key]
      if (
        typeof srcVal === 'object' &&
        srcVal !== null &&
        !Array.isArray(srcVal) &&
        typeof tgtVal === 'object' &&
        tgtVal !== null
      ) {
        result[key] = deepMerge(
          tgtVal as Record<string, unknown>,
          srcVal as Record<string, unknown>
        ) as T[typeof key]
      } else {
        result[key] = srcVal as T[typeof key]
      }
    }
  }
  return result
}

async function requireSettings() {
  const org = await db.query.settings.findFirst()
  if (!org) {
    throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
  }
  return org
}

function wrapDbError(operation: string, error: unknown): never {
  if (error instanceof NotFoundError || error instanceof ValidationError) {
    throw error
  }
  throw new InternalError(
    'DATABASE_ERROR',
    `Failed to ${operation}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    error
  )
}

// ============================================
// AUTH CONFIGURATION (Team sign-in)
// ============================================

export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
  } catch (error) {
    wrapDbError('fetch auth config', error)
  }
}

export async function updateAuthConfig(input: UpdateAuthConfigInput): Promise<AuthConfig> {
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    const updated = deepMerge(existing, input as Partial<AuthConfig>)

    await db
      .update(settings)
      .set({ authConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))

    return updated
  } catch (error) {
    wrapDbError('update auth config', error)
  }
}

// ============================================
// PORTAL CONFIGURATION
// ============================================

export async function getPortalConfig(): Promise<PortalConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
  } catch (error) {
    wrapDbError('fetch portal config', error)
  }
}

export async function updatePortalConfig(input: UpdatePortalConfigInput): Promise<PortalConfig> {
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    const updated = deepMerge(existing, input as Partial<PortalConfig>)

    await db
      .update(settings)
      .set({ portalConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))

    return updated
  } catch (error) {
    wrapDbError('update portal config', error)
  }
}

// ============================================
// BRANDING CONFIGURATION
// ============================================

export async function getBrandingConfig(): Promise<BrandingConfig> {
  try {
    const org = await requireSettings()
    return parseJsonOrNull<BrandingConfig>(org.brandingConfig) ?? {}
  } catch (error) {
    wrapDbError('fetch branding config', error)
  }
}

export async function updateBrandingConfig(config: BrandingConfig): Promise<BrandingConfig> {
  try {
    const org = await requireSettings()
    await db
      .update(settings)
      .set({ brandingConfig: JSON.stringify(config) })
      .where(eq(settings.id, org.id))

    return config
  } catch (error) {
    wrapDbError('update branding config', error)
  }
}

// ============================================
// LOGO MANAGEMENT
// ============================================

export async function uploadLogo(data: {
  blob: Buffer
  mimeType: string
}): Promise<{ success: true }> {
  try {
    const org = await requireSettings()
    await db
      .update(settings)
      .set({ logoBlob: data.blob, logoType: data.mimeType })
      .where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    wrapDbError('upload logo', error)
  }
}

export async function deleteLogo(): Promise<{ success: true }> {
  try {
    const org = await requireSettings()
    await db.update(settings).set({ logoBlob: null, logoType: null }).where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    wrapDbError('delete logo', error)
  }
}

export async function uploadHeaderLogo(data: {
  blob: Buffer
  mimeType: string
}): Promise<{ success: true }> {
  try {
    const org = await requireSettings()
    await db
      .update(settings)
      .set({ headerLogoBlob: data.blob, headerLogoType: data.mimeType })
      .where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    wrapDbError('upload header logo', error)
  }
}

export async function deleteHeaderLogo(): Promise<{ success: true }> {
  try {
    const org = await requireSettings()
    await db
      .update(settings)
      .set({ headerLogoBlob: null, headerLogoType: null })
      .where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    wrapDbError('delete header logo', error)
  }
}

// ============================================
// HEADER DISPLAY SETTINGS
// ============================================

const VALID_HEADER_MODES = ['logo_and_name', 'logo_only', 'custom_logo'] as const

export async function updateHeaderDisplayMode(mode: string): Promise<string> {
  if (!VALID_HEADER_MODES.includes(mode as (typeof VALID_HEADER_MODES)[number])) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid header display mode: ${mode}`)
  }

  try {
    const org = await requireSettings()
    const [updated] = await db
      .update(settings)
      .set({ headerDisplayMode: mode })
      .where(eq(settings.id, org.id))
      .returning()

    return updated?.headerDisplayMode || 'logo_and_name'
  } catch (error) {
    wrapDbError('update header display mode', error)
  }
}

export async function updateHeaderDisplayName(name: string | null): Promise<string | null> {
  try {
    const org = await requireSettings()
    const sanitizedName = name?.trim() || null

    const [updated] = await db
      .update(settings)
      .set({ headerDisplayName: sanitizedName })
      .where(eq(settings.id, org.id))
      .returning()

    return updated?.headerDisplayName ?? null
  } catch (error) {
    wrapDbError('update header display name', error)
  }
}

export async function updateWorkspaceName(name: string): Promise<string> {
  try {
    const org = await requireSettings()
    const sanitizedName = name.trim()

    if (!sanitizedName) {
      throw new ValidationError('INVALID_NAME', 'Workspace name cannot be empty')
    }

    const [updated] = await db
      .update(settings)
      .set({ name: sanitizedName })
      .where(eq(settings.id, org.id))
      .returning()

    return updated?.name ?? sanitizedName
  } catch (error) {
    wrapDbError('update workspace name', error)
  }
}

// ============================================
// OIDC CONFIGURATION
// ============================================

/**
 * Get OIDC config for admin settings page.
 * Returns null if OIDC is not configured.
 */
export async function getOIDCConfig(): Promise<AdminOIDCConfig | null> {
  try {
    const org = await requireSettings()
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

    if (!portalConfig.oidc) return null

    return {
      enabled: portalConfig.oidc.enabled,
      displayName: portalConfig.oidc.displayName,
      issuer: portalConfig.oidc.issuer,
      clientId: portalConfig.oidc.clientId,
      hasSecret: !!portalConfig.oidc.clientSecretEncrypted,
      scopes: portalConfig.oidc.scopes,
      emailDomain: portalConfig.oidc.emailDomain,
    }
  } catch (error) {
    wrapDbError('fetch OIDC config', error)
  }
}

/**
 * Get full OIDC config (including encrypted secret) for OAuth flow.
 * This is internal and should not be exposed to clients.
 */
export async function getFullOIDCConfig(): Promise<OIDCProviderConfig | null> {
  try {
    const org = await requireSettings()
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

    if (!portalConfig.oidc || !portalConfig.oidc.enabled) return null

    return portalConfig.oidc
  } catch (error) {
    wrapDbError('fetch full OIDC config', error)
  }
}

/**
 * Update OIDC config.
 * Validates discovery before saving and encrypts the client secret.
 */
export async function updateOIDCConfig(
  input: UpdateOIDCConfigInput,
  workspaceId: string
): Promise<AdminOIDCConfig> {
  try {
    await validateOIDCIssuer(input.issuer)

    const org = await requireSettings()
    const existing = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    const oidcConfig = buildOIDCProviderConfig(input, existing.oidc, workspaceId)

    if (oidcConfig.enabled && !isOIDCProviderComplete(oidcConfig)) {
      throw new ValidationError('OIDC_INCOMPLETE', 'Issuer, client ID, and secret are required')
    }

    await db
      .update(settings)
      .set({ portalConfig: JSON.stringify({ ...existing, oidc: oidcConfig }) })
      .where(eq(settings.id, org.id))

    return toAdminOIDCConfig(oidcConfig)
  } catch (error) {
    wrapDbError('update OIDC config', error)
  }
}

/**
 * Delete OIDC config from portal settings.
 */
export async function deleteOIDCConfig(): Promise<{ success: true }> {
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

    // Remove OIDC config
    const { oidc: _, ...rest } = existing
    await db
      .update(settings)
      .set({ portalConfig: JSON.stringify(rest) })
      .where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    wrapDbError('delete OIDC config', error)
  }
}

// ============================================
// SECURITY CONFIGURATION (Team SSO)
// ============================================

/**
 * Internal type for security config as stored in authConfig JSON
 * The authConfig JSON column stores both AuthConfig and SecurityConfig
 */
interface AuthConfigWithSecurity extends AuthConfig {
  security?: SecurityConfig
}

/**
 * Helper to parse auth config with security settings from database.
 * Reduces duplication across security config functions.
 */
async function getAuthConfigWithSecurity(): Promise<{
  org: Awaited<ReturnType<typeof requireSettings>>
  authConfig: AuthConfigWithSecurity
  securityConfig: SecurityConfig
}> {
  const org = await requireSettings()
  const authConfig = parseJsonConfig<AuthConfigWithSecurity>(org.authConfig, {
    ...DEFAULT_AUTH_CONFIG,
    security: DEFAULT_SECURITY_CONFIG,
  })
  const securityConfig = authConfig.security || DEFAULT_SECURITY_CONFIG
  return { org, authConfig, securityConfig }
}

/**
 * Transform OIDCProviderConfig to AdminOIDCConfig (removes secrets, adds hasSecret flag).
 */
function toAdminOIDCConfig(provider: OIDCProviderConfig): AdminOIDCConfig {
  return {
    enabled: provider.enabled,
    displayName: provider.displayName,
    issuer: provider.issuer,
    clientId: provider.clientId,
    hasSecret: !!provider.clientSecretEncrypted,
    scopes: provider.scopes,
    emailDomain: provider.emailDomain,
  }
}

/**
 * Validate OIDC discovery endpoint if issuer is provided.
 */
async function validateOIDCIssuer(issuer: string | undefined): Promise<void> {
  if (!issuer) return
  const discovery = await fetchOIDCDiscovery(issuer)
  if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
    throw new ValidationError('INVALID_OIDC_PROVIDER', 'Provider missing required endpoints')
  }
}

/**
 * Build OIDC provider config by merging input with existing config.
 */
function buildOIDCProviderConfig(
  input: UpdateOIDCConfigInput,
  existing: OIDCProviderConfig | undefined,
  workspaceId: string
): OIDCProviderConfig {
  const clientSecretEncrypted = input.clientSecret
    ? encryptOIDCSecret(input.clientSecret, workspaceId)
    : (existing?.clientSecretEncrypted ?? '')

  return {
    enabled: input.enabled ?? existing?.enabled ?? false,
    displayName: input.displayName ?? existing?.displayName ?? 'SSO',
    issuer: input.issuer ?? existing?.issuer ?? '',
    clientId: input.clientId ?? existing?.clientId ?? '',
    clientSecretEncrypted,
    scopes: input.scopes ?? existing?.scopes,
    emailDomain: input.emailDomain ?? existing?.emailDomain,
  }
}

/**
 * Check if OIDC provider has all required fields configured.
 */
function isOIDCProviderComplete(provider: OIDCProviderConfig | undefined): boolean {
  return !!(provider?.issuer && provider?.clientId && provider?.clientSecretEncrypted)
}

/**
 * Get security config for admin settings page.
 * Returns config with provider info (but not actual secrets).
 */
export async function getSecurityConfig(): Promise<AdminSecurityConfig> {
  try {
    const { securityConfig } = await getAuthConfigWithSecurity()

    return {
      sso: {
        enabled: securityConfig.sso.enabled,
        enforcement: securityConfig.sso.enforcement,
        provider: securityConfig.sso.provider
          ? toAdminOIDCConfig(securityConfig.sso.provider)
          : undefined,
      },
      teamSocialLogin: securityConfig.teamSocialLogin,
    }
  } catch (error) {
    wrapDbError('fetch security config', error)
  }
}

/**
 * Get public security config for team login page (no secrets).
 */
export async function getPublicSecurityConfig(): Promise<PublicSecurityConfig> {
  try {
    const { securityConfig } = await getAuthConfigWithSecurity()

    return {
      sso: {
        enabled: securityConfig.sso.enabled,
        enforcement: securityConfig.sso.enforcement,
        displayName: securityConfig.sso.provider?.displayName,
      },
      teamSocialLogin: securityConfig.teamSocialLogin,
    }
  } catch (error) {
    wrapDbError('fetch public security config', error)
  }
}

/**
 * Get full security config (including encrypted secrets) for internal use.
 * This is used by the OAuth flow to get provider credentials.
 */
export async function getFullSecurityConfig(): Promise<SecurityConfig | null> {
  try {
    const { securityConfig } = await getAuthConfigWithSecurity()
    return securityConfig
  } catch (error) {
    wrapDbError('fetch full security config', error)
  }
}

/**
 * Update security config.
 * Validates requirements before saving (e.g., cannot set required without configured SSO).
 */
export async function updateSecurityConfig(
  input: UpdateSecurityConfigInput,
  workspaceId: string
): Promise<AdminSecurityConfig> {
  try {
    const { org, authConfig, securityConfig: existing } = await getAuthConfigWithSecurity()

    // Build updated SSO provider if input provided
    let updatedSSOProvider = existing.sso.provider
    if (input.sso?.provider) {
      await validateOIDCIssuer(input.sso.provider.issuer)
      updatedSSOProvider = buildOIDCProviderConfig(
        input.sso.provider,
        existing.sso.provider,
        workspaceId
      )
    }

    const updatedSecurityConfig: SecurityConfig = {
      sso: {
        enabled: input.sso?.enabled ?? existing.sso.enabled,
        enforcement: input.sso?.enforcement ?? existing.sso.enforcement,
        provider: updatedSSOProvider,
      },
      teamSocialLogin: {
        email: input.teamSocialLogin?.email ?? existing.teamSocialLogin.email,
        github: input.teamSocialLogin?.github ?? existing.teamSocialLogin.github,
        google: input.teamSocialLogin?.google ?? existing.teamSocialLogin.google,
      },
    }

    // Validation: Cannot set enforcement to 'required' without configured SSO provider
    if (
      updatedSecurityConfig.sso.enforcement === 'required' &&
      !isOIDCProviderComplete(updatedSecurityConfig.sso.provider)
    ) {
      throw new ValidationError(
        'SSO_NOT_CONFIGURED',
        'Cannot require SSO without a configured provider'
      )
    }

    // Validation: Required fields when enabling SSO
    if (
      updatedSecurityConfig.sso.enabled &&
      updatedSecurityConfig.sso.provider &&
      !isOIDCProviderComplete(updatedSecurityConfig.sso.provider)
    ) {
      throw new ValidationError('SSO_INCOMPLETE', 'Issuer, client ID, and secret are required')
    }

    await db
      .update(settings)
      .set({ authConfig: JSON.stringify({ ...authConfig, security: updatedSecurityConfig }) })
      .where(eq(settings.id, org.id))

    return {
      sso: {
        enabled: updatedSecurityConfig.sso.enabled,
        enforcement: updatedSecurityConfig.sso.enforcement,
        provider: updatedSecurityConfig.sso.provider
          ? toAdminOIDCConfig(updatedSecurityConfig.sso.provider)
          : undefined,
      },
      teamSocialLogin: updatedSecurityConfig.teamSocialLogin,
    }
  } catch (error) {
    wrapDbError('update security config', error)
  }
}

/**
 * Delete team SSO configuration.
 */
export async function deleteTeamSSOConfig(): Promise<{ success: true }> {
  try {
    const { org, authConfig, securityConfig: existing } = await getAuthConfigWithSecurity()

    // Reset SSO config but keep social login settings
    const updatedSecurityConfig: SecurityConfig = {
      sso: {
        enabled: false,
        enforcement: 'optional',
        provider: undefined,
      },
      teamSocialLogin: existing.teamSocialLogin,
    }

    const updatedAuthConfig: AuthConfigWithSecurity = {
      ...authConfig,
      security: updatedSecurityConfig,
    }

    await db
      .update(settings)
      .set({ authConfig: JSON.stringify(updatedAuthConfig) })
      .where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    wrapDbError('delete team SSO config', error)
  }
}

// ============================================
// PUBLIC CONFIG (NO AUTH REQUIRED)
// ============================================

export async function getPublicAuthConfig(): Promise<PublicAuthConfig> {
  try {
    const org = await requireSettings()
    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)

    return {
      oauth: authConfig.oauth,
      openSignup: authConfig.openSignup,
    }
  } catch (error) {
    wrapDbError('fetch public auth config', error)
  }
}

export async function getPublicPortalConfig(): Promise<PublicPortalConfig> {
  try {
    const org = await requireSettings()
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

    return {
      oauth: portalConfig.oauth,
      features: portalConfig.features,
      oidc: portalConfig.oidc?.enabled
        ? {
            enabled: true,
            displayName: portalConfig.oidc.displayName,
          }
        : undefined,
    }
  } catch (error) {
    wrapDbError('fetch public portal config', error)
  }
}

// ============================================
// CONSOLIDATED SETTINGS DATA
// ============================================

/**
 * Helper to convert a bytea blob and MIME type to a data URL.
 */
function blobToDataUrl(blob: Buffer | null, mimeType: string | null): string | null {
  if (!blob || !mimeType) return null
  const base64 = Buffer.from(blob).toString('base64')
  return `data:${mimeType};base64,${base64}`
}

/**
 * Branding data extracted from settings (logo URLs, header config)
 */
export interface SettingsBrandingData {
  name: string
  logoUrl: string | null
  faviconUrl: string | null
  headerLogoUrl: string | null
  headerDisplayMode: string | null
  headerDisplayName: string | null
}

/**
 * Consolidated settings data returned by getSettingsWithAllConfigs()
 * Contains all parsed configs and branding data from a single query.
 */
export interface SettingsWithAllConfigs {
  /** Raw settings record */
  settings: Awaited<ReturnType<typeof requireSettings>>
  /** Parsed auth configuration */
  authConfig: AuthConfig
  /** Parsed portal configuration */
  portalConfig: PortalConfig
  /** Parsed branding/theme configuration */
  brandingConfig: BrandingConfig
  /** Public auth config subset */
  publicAuthConfig: PublicAuthConfig
  /** Public portal config subset */
  publicPortalConfig: PublicPortalConfig
  /** Branding data with data URLs for logos */
  brandingData: SettingsBrandingData
  /** Favicon data URL or null */
  faviconData: { url: string } | null
}

/**
 * Get all settings data in a single query.
 *
 * This consolidates multiple separate queries into one database call,
 * returning all parsed configs and branding data needed by the portal.
 *
 * Use this in route loaders to avoid redundant database queries.
 */
export async function getSettingsWithAllConfigs(): Promise<SettingsWithAllConfigs> {
  try {
    const org = await requireSettings()

    // Parse all JSON configs
    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    const brandingConfig = parseJsonOrNull<BrandingConfig>(org.brandingConfig) ?? {}

    // Build public config subsets
    const publicAuthConfig: PublicAuthConfig = {
      oauth: authConfig.oauth,
      openSignup: authConfig.openSignup,
    }

    const publicPortalConfig: PublicPortalConfig = {
      oauth: portalConfig.oauth,
      features: portalConfig.features,
      oidc: portalConfig.oidc?.enabled
        ? {
            enabled: true,
            displayName: portalConfig.oidc.displayName,
          }
        : undefined,
    }

    // Build branding data with data URLs
    const brandingData: SettingsBrandingData = {
      name: org.name,
      logoUrl: blobToDataUrl(org.logoBlob, org.logoType),
      faviconUrl: blobToDataUrl(org.faviconBlob, org.faviconType),
      headerLogoUrl: blobToDataUrl(org.headerLogoBlob, org.headerLogoType),
      headerDisplayMode: org.headerDisplayMode,
      headerDisplayName: org.headerDisplayName,
    }

    // Build favicon data
    const faviconUrl = blobToDataUrl(org.faviconBlob, org.faviconType)
    const faviconData = faviconUrl ? { url: faviconUrl } : null

    return {
      settings: org,
      authConfig,
      portalConfig,
      brandingConfig,
      publicAuthConfig,
      publicPortalConfig,
      brandingData,
      faviconData,
    }
  } catch (error) {
    wrapDbError('fetch settings with all configs', error)
  }
}
