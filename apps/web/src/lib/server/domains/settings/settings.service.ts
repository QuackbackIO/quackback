import { db, eq, settings } from '@/lib/server/db'
import { NotFoundError, InternalError, ValidationError } from '@/lib/shared/errors'
import { tenantStorage } from '@/lib/server/tenant'
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
import { encryptOIDCSecret, fetchOIDCDiscovery } from '@/lib/server/auth/oidc.service'

type SettingsRecord = NonNullable<Awaited<ReturnType<typeof db.query.settings.findFirst>>>

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
      const isNestedObject =
        typeof srcVal === 'object' &&
        srcVal !== null &&
        !Array.isArray(srcVal) &&
        typeof tgtVal === 'object' &&
        tgtVal !== null

      result[key] = isNestedObject
        ? (deepMerge(
            tgtVal as Record<string, unknown>,
            srcVal as Record<string, unknown>
          ) as T[typeof key])
        : (srcVal as T[typeof key])
    }
  }
  return result
}

function getCachedSettings(): SettingsRecord | undefined {
  const ctx = tenantStorage.getStore()
  const cached = ctx?.cache.get('settings') as SettingsRecord | undefined
  return cached ?? (ctx?.settings as SettingsRecord) ?? undefined
}

function setCachedSettings(data: SettingsRecord): void {
  tenantStorage.getStore()?.cache.set('settings', data)
}

async function requireSettings(): Promise<SettingsRecord> {
  const cached = getCachedSettings()
  if (cached) return cached

  const org = await db.query.settings.findFirst()
  if (!org) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')

  setCachedSettings(org)
  return org
}

function wrapDbError(operation: string, error: unknown): never {
  if (error instanceof NotFoundError || error instanceof ValidationError) throw error
  const message = error instanceof Error ? error.message : 'Unknown error'
  throw new InternalError('DATABASE_ERROR', `Failed to ${operation}: ${message}`, error)
}

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

    const hasAuthMethod =
      updated.oauth.email || updated.oauth.github || updated.oauth.google || updated.oidc?.enabled
    if (!hasAuthMethod) {
      throw new ValidationError(
        'AUTH_METHOD_REQUIRED',
        'At least one authentication method must be enabled'
      )
    }

    await db
      .update(settings)
      .set({ portalConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
    return updated
  } catch (error) {
    wrapDbError('update portal config', error)
  }
}

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
    if (!sanitizedName) throw new ValidationError('INVALID_NAME', 'Workspace name cannot be empty')

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

export async function getFullOIDCConfig(): Promise<OIDCProviderConfig | null> {
  try {
    const org = await requireSettings()
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    if (!portalConfig.oidc?.enabled) return null
    return portalConfig.oidc
  } catch (error) {
    wrapDbError('fetch full OIDC config', error)
  }
}

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

export async function deleteOIDCConfig(): Promise<{ success: true }> {
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
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

interface AuthConfigWithSecurity extends AuthConfig {
  security?: SecurityConfig
}

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
  return { org, authConfig, securityConfig: authConfig.security || DEFAULT_SECURITY_CONFIG }
}

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

async function validateOIDCIssuer(issuer: string | undefined): Promise<void> {
  if (!issuer) return
  const discovery = await fetchOIDCDiscovery(issuer)
  if (!discovery.authorization_endpoint || !discovery.token_endpoint) {
    throw new ValidationError('INVALID_OIDC_PROVIDER', 'Provider missing required endpoints')
  }
}

function buildOIDCProviderConfig(
  input: UpdateOIDCConfigInput,
  existing: OIDCProviderConfig | undefined,
  workspaceId: string
): OIDCProviderConfig {
  return {
    enabled: input.enabled ?? existing?.enabled ?? false,
    displayName: input.displayName ?? existing?.displayName ?? 'SSO',
    issuer: input.issuer ?? existing?.issuer ?? '',
    clientId: input.clientId ?? existing?.clientId ?? '',
    clientSecretEncrypted: input.clientSecret
      ? encryptOIDCSecret(input.clientSecret, workspaceId)
      : (existing?.clientSecretEncrypted ?? ''),
    scopes: input.scopes ?? existing?.scopes,
    emailDomain: input.emailDomain ?? existing?.emailDomain,
  }
}

function isOIDCProviderComplete(provider: OIDCProviderConfig | undefined): boolean {
  return !!(provider?.issuer && provider?.clientId && provider?.clientSecretEncrypted)
}

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

export async function getFullSecurityConfig(): Promise<SecurityConfig | null> {
  try {
    const { securityConfig } = await getAuthConfigWithSecurity()
    return securityConfig
  } catch (error) {
    wrapDbError('fetch full security config', error)
  }
}

export async function updateSecurityConfig(
  input: UpdateSecurityConfigInput,
  workspaceId: string
): Promise<AdminSecurityConfig> {
  try {
    const { org, authConfig, securityConfig: existing } = await getAuthConfigWithSecurity()

    let updatedSSOProvider = existing.sso.provider
    if (input.sso?.provider) {
      await validateOIDCIssuer(input.sso.provider.issuer)
      updatedSSOProvider = buildOIDCProviderConfig(
        input.sso.provider,
        existing.sso.provider,
        workspaceId
      )
    }

    const updated: SecurityConfig = {
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

    if (updated.sso.enforcement === 'required' && !isOIDCProviderComplete(updated.sso.provider)) {
      throw new ValidationError(
        'SSO_NOT_CONFIGURED',
        'Cannot require SSO without a configured provider'
      )
    }
    if (
      updated.sso.enabled &&
      updated.sso.provider &&
      !isOIDCProviderComplete(updated.sso.provider)
    ) {
      throw new ValidationError('SSO_INCOMPLETE', 'Issuer, client ID, and secret are required')
    }

    await db
      .update(settings)
      .set({ authConfig: JSON.stringify({ ...authConfig, security: updated }) })
      .where(eq(settings.id, org.id))

    return {
      sso: {
        enabled: updated.sso.enabled,
        enforcement: updated.sso.enforcement,
        provider: updated.sso.provider ? toAdminOIDCConfig(updated.sso.provider) : undefined,
      },
      teamSocialLogin: updated.teamSocialLogin,
    }
  } catch (error) {
    wrapDbError('update security config', error)
  }
}

export async function deleteTeamSSOConfig(): Promise<{ success: true }> {
  try {
    const { org, authConfig, securityConfig: existing } = await getAuthConfigWithSecurity()
    const updated: SecurityConfig = {
      sso: { enabled: false, enforcement: 'optional', provider: undefined },
      teamSocialLogin: existing.teamSocialLogin,
    }
    await db
      .update(settings)
      .set({ authConfig: JSON.stringify({ ...authConfig, security: updated }) })
      .where(eq(settings.id, org.id))
    return { success: true }
  } catch (error) {
    wrapDbError('delete team SSO config', error)
  }
}

export async function getPublicAuthConfig(): Promise<PublicAuthConfig> {
  try {
    const org = await requireSettings()
    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    return { oauth: authConfig.oauth, openSignup: authConfig.openSignup }
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
        ? { enabled: true, displayName: portalConfig.oidc.displayName }
        : undefined,
    }
  } catch (error) {
    wrapDbError('fetch public portal config', error)
  }
}

function blobToDataUrl(
  blob: Buffer | null,
  mimeType: string | null,
  cacheKey?: string
): string | null {
  if (!blob || !mimeType) return null

  const ctx = tenantStorage.getStore()
  if (cacheKey) {
    const cached = ctx?.cache.get(cacheKey) as string | undefined
    if (cached) return cached
  }

  const dataUrl = `data:${mimeType};base64,${Buffer.from(blob).toString('base64')}`
  if (cacheKey) ctx?.cache.set(cacheKey, dataUrl)

  return dataUrl
}

export interface SettingsBrandingData {
  name: string
  logoUrl: string | null
  faviconUrl: string | null
  headerLogoUrl: string | null
  headerDisplayMode: string | null
  headerDisplayName: string | null
}

export interface TenantSettings {
  /** Raw settings record from database */
  settings: Awaited<ReturnType<typeof requireSettings>>
  /** Workspace name (convenience property) */
  name: string
  /** Workspace slug (convenience property) */
  slug: string
  authConfig: AuthConfig
  portalConfig: PortalConfig
  brandingConfig: BrandingConfig
  publicAuthConfig: PublicAuthConfig
  publicPortalConfig: PublicPortalConfig
  brandingData: SettingsBrandingData
  faviconData: { url: string } | null
}

export async function getTenantSettings(): Promise<TenantSettings | null> {
  try {
    const org = getCachedSettings() ?? (await db.query.settings.findFirst()) ?? null
    if (!org) return null

    setCachedSettings(org)

    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    const brandingConfig = parseJsonOrNull<BrandingConfig>(org.brandingConfig) ?? {}

    const brandingData: SettingsBrandingData = {
      name: org.name,
      logoUrl: blobToDataUrl(org.logoBlob, org.logoType, 'branding:logo'),
      faviconUrl: blobToDataUrl(org.faviconBlob, org.faviconType, 'branding:favicon'),
      headerLogoUrl: blobToDataUrl(org.headerLogoBlob, org.headerLogoType, 'branding:headerLogo'),
      headerDisplayMode: org.headerDisplayMode,
      headerDisplayName: org.headerDisplayName,
    }

    return {
      settings: org,
      name: org.name,
      slug: org.slug,
      authConfig,
      portalConfig,
      brandingConfig,
      publicAuthConfig: { oauth: authConfig.oauth, openSignup: authConfig.openSignup },
      publicPortalConfig: {
        oauth: portalConfig.oauth,
        features: portalConfig.features,
        oidc: portalConfig.oidc?.enabled
          ? { enabled: true, displayName: portalConfig.oidc.displayName }
          : undefined,
      },
      brandingData,
      faviconData: brandingData.faviconUrl ? { url: brandingData.faviconUrl } : null,
    }
  } catch (error) {
    wrapDbError('fetch settings with all configs', error)
  }
}
