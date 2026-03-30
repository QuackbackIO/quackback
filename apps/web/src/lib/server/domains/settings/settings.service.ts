import { db, eq, settings } from '@/lib/server/db'
import { cacheGet, cacheSet, CACHE_KEYS } from '@/lib/server/redis'
import { ValidationError } from '@/lib/shared/errors'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import type {
  AuthConfig,
  UpdateAuthConfigInput,
  PortalConfig,
  UpdatePortalConfigInput,
  BrandingConfig,
  PublicAuthConfig,
  PublicPortalConfig,
  DeveloperConfig,
  UpdateDeveloperConfigInput,
  FeatureFlags,
  TenantSettings,
  SettingsBrandingData,
} from './settings.types'
import {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_DEVELOPER_CONFIG,
  DEFAULT_WIDGET_CONFIG,
  DEFAULT_FEATURE_FLAGS,
} from './settings.types'
import {
  parseJsonConfig,
  parseJsonOrNull,
  deepMerge,
  requireSettings,
  wrapDbError,
  invalidateSettingsCache,
} from './settings.helpers'

async function getConfiguredAuthTypes(): Promise<Set<string>> {
  const { getConfiguredIntegrationTypes } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')
  return getConfiguredIntegrationTypes()
}

function filterOAuthByCredentials(
  oauth: Record<string, boolean | undefined>,
  configuredTypes: Set<string>,
  passthroughKeys: string[]
): Record<string, boolean | undefined> {
  const passthrough = new Set(passthroughKeys)
  const filtered: Record<string, boolean | undefined> = {}
  for (const [key, enabled] of Object.entries(oauth)) {
    if (passthrough.has(key)) {
      filtered[key] = enabled
    } else {
      filtered[key] = enabled && configuredTypes.has(`auth_${key}`)
    }
  }
  return filtered
}

async function getPortalPassthroughKeys(): Promise<string[]> {
  const { isEmailConfigured } = await import('@featurepool/email')
  return isEmailConfigured() ? ['email', 'password'] : ['password']
}

/**
 * Fetch display name overrides for generic OAuth providers (e.g. custom-oidc).
 * Returns a map of providerId → displayName for providers that have a custom displayName configured.
 */
async function getCustomProviderNames(
  oauth: Record<string, boolean | undefined>,
  configuredTypes: Set<string>
): Promise<Record<string, string> | undefined> {
  const { getAllAuthProviders } = await import('@/lib/server/auth/auth-providers')
  const { getPlatformCredentials } =
    await import('@/lib/server/domains/platform-credentials/platform-credential.service')

  const genericProviders = getAllAuthProviders().filter(
    (p) => p.type === 'generic-oauth' && oauth[p.id] && configuredTypes.has(p.credentialType)
  )

  if (genericProviders.length === 0) return undefined

  const names: Record<string, string> = {}
  for (const provider of genericProviders) {
    const creds = await getPlatformCredentials(provider.credentialType)
    if (creds?.displayName) {
      names[provider.id] = creds.displayName
    }
  }

  return Object.keys(names).length > 0 ? names : undefined
}

export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
  } catch (error) {
    console.error(`[domain:settings] getAuthConfig failed:`, error)
    wrapDbError('fetch auth config', error)
  }
}

export async function updateAuthConfig(input: UpdateAuthConfigInput): Promise<AuthConfig> {
  console.log(`[domain:settings] updateAuthConfig`)
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    const updated = deepMerge(existing, input as Partial<AuthConfig>)
    await db
      .update(settings)
      .set({ authConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return updated
  } catch (error) {
    console.error(`[domain:settings] updateAuthConfig failed:`, error)
    wrapDbError('update auth config', error)
  }
}

export async function getPortalConfig(): Promise<PortalConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
  } catch (error) {
    console.error(`[domain:settings] getPortalConfig failed:`, error)
    wrapDbError('fetch portal config', error)
  }
}

export async function updatePortalConfig(input: UpdatePortalConfigInput): Promise<PortalConfig> {
  console.log(`[domain:settings] updatePortalConfig`)
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    const updated = deepMerge(existing, input as Partial<PortalConfig>)

    const hasAuthMethod = Object.values(updated.oauth).some(Boolean)
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
    await invalidateSettingsCache()
    return updated
  } catch (error) {
    console.error(`[domain:settings] updatePortalConfig failed:`, error)
    wrapDbError('update portal config', error)
  }
}

export async function getDeveloperConfig(): Promise<DeveloperConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.developerConfig, DEFAULT_DEVELOPER_CONFIG)
  } catch (error) {
    console.error(`[domain:settings] getDeveloperConfig failed:`, error)
    wrapDbError('fetch developer config', error)
  }
}

export async function updateDeveloperConfig(
  input: UpdateDeveloperConfigInput
): Promise<DeveloperConfig> {
  console.log(`[domain:settings] updateDeveloperConfig`)
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.developerConfig, DEFAULT_DEVELOPER_CONFIG)
    const updated = deepMerge(existing, input as Partial<DeveloperConfig>)
    await db
      .update(settings)
      .set({ developerConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return updated
  } catch (error) {
    console.error(`[domain:settings] updateDeveloperConfig failed:`, error)
    wrapDbError('update developer config', error)
  }
}

export async function getPublicAuthConfig(): Promise<PublicAuthConfig> {
  try {
    const org = await requireSettings()
    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)

    const configuredTypes = await getConfiguredAuthTypes()
    const filteredOAuth = filterOAuthByCredentials(authConfig.oauth, configuredTypes, ['password'])
    const customProviderNames = await getCustomProviderNames(filteredOAuth, configuredTypes)
    return {
      oauth: filteredOAuth,
      openSignup: authConfig.openSignup,
      ...(customProviderNames && { customProviderNames }),
    }
  } catch (error) {
    console.error(`[domain:settings] getPublicAuthConfig failed:`, error)
    wrapDbError('fetch public auth config', error)
  }
}

export async function getPublicPortalConfig(): Promise<PublicPortalConfig> {
  try {
    const org = await requireSettings()
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

    const [configuredTypes, passthroughKeys] = await Promise.all([
      getConfiguredAuthTypes(),
      getPortalPassthroughKeys(),
    ])
    const filteredOAuth = filterOAuthByCredentials(
      portalConfig.oauth,
      configuredTypes,
      passthroughKeys
    )
    const customProviderNames = await getCustomProviderNames(filteredOAuth, configuredTypes)
    return {
      oauth: filteredOAuth,
      features: portalConfig.features,
      ...(customProviderNames && { customProviderNames }),
    }
  } catch (error) {
    console.error(`[domain:settings] getPublicPortalConfig failed:`, error)
    wrapDbError('fetch public portal config', error)
  }
}

// TenantSettings and SettingsBrandingData are defined in settings.types.ts
// to prevent client-side barrel imports from pulling in this server-only module.

export async function getTenantSettings(): Promise<TenantSettings | null> {
  try {
    const cached = await cacheGet<TenantSettings>(CACHE_KEYS.TENANT_SETTINGS)
    if (cached) {
      console.log(`[domain:settings] getTenantSettings: cache hit`)
      return cached
    }

    const org = await db.query.settings.findFirst()
    if (!org) return null

    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    const brandingConfig = parseJsonOrNull<BrandingConfig>(org.brandingConfig) ?? {}
    const developerConfig = parseJsonConfig(org.developerConfig, DEFAULT_DEVELOPER_CONFIG)

    const widgetConfig = parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)

    const featureFlags: FeatureFlags = {
      ...DEFAULT_FEATURE_FLAGS,
      ...(org.featureFlags ? JSON.parse(org.featureFlags) : {}),
    }

    const [configuredTypes, portalPassthroughKeys] = await Promise.all([
      getConfiguredAuthTypes(),
      getPortalPassthroughKeys(),
    ])
    const filteredAuthOAuth = filterOAuthByCredentials(authConfig.oauth, configuredTypes, [
      'password',
    ])
    const filteredPortalOAuth = filterOAuthByCredentials(
      portalConfig.oauth,
      configuredTypes,
      portalPassthroughKeys
    )
    const [authCustomNames, portalCustomNames] = await Promise.all([
      getCustomProviderNames(filteredAuthOAuth, configuredTypes),
      getCustomProviderNames(filteredPortalOAuth, configuredTypes),
    ])

    const brandingData: SettingsBrandingData = {
      name: org.name,
      logoUrl: getPublicUrlOrNull(org.logoKey),
      faviconUrl: getPublicUrlOrNull(org.faviconKey),
      headerLogoUrl: getPublicUrlOrNull(org.headerLogoKey),
      headerDisplayMode: org.headerDisplayMode,
      headerDisplayName: org.headerDisplayName,
    }

    const result: TenantSettings = {
      settings: org,
      name: org.name,
      slug: org.slug,
      authConfig,
      portalConfig,
      brandingConfig,
      developerConfig,
      customCss: org.customCss ?? '',
      publicAuthConfig: {
        oauth: filteredAuthOAuth,
        openSignup: authConfig.openSignup,
        ...(authCustomNames && { customProviderNames: authCustomNames }),
      },
      publicPortalConfig: {
        oauth: filteredPortalOAuth,
        features: portalConfig.features,
        ...(portalCustomNames && { customProviderNames: portalCustomNames }),
      },
      publicWidgetConfig: {
        enabled: widgetConfig.enabled,
        defaultBoard: widgetConfig.defaultBoard,
        position: widgetConfig.position,
        tabs: widgetConfig.tabs,
        hmacRequired: widgetConfig.identifyVerification ?? false,
      },
      featureFlags,
      brandingData,
      faviconData: brandingData.faviconUrl ? { url: brandingData.faviconUrl } : null,
    }

    await cacheSet(CACHE_KEYS.TENANT_SETTINGS, result, 300)
    return result
  } catch (error) {
    console.error(`[domain:settings] getTenantSettings failed:`, error)
    wrapDbError('fetch settings with all configs', error)
  }
}

// ============================================================================
// Feature Flags
// ============================================================================

/**
 * Get current feature flags, merged with defaults
 */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  const settings = await getTenantSettings()
  return settings?.featureFlags ?? DEFAULT_FEATURE_FLAGS
}

/**
 * Check if a specific feature flag is enabled
 */
export async function isFeatureEnabled(flag: keyof FeatureFlags): Promise<boolean> {
  const flags = await getFeatureFlags()
  return flags[flag] ?? false
}

/**
 * Update feature flags (partial update, merges with existing)
 */
export async function updateFeatureFlags(input: Partial<FeatureFlags>): Promise<FeatureFlags> {
  const org = await requireSettings()
  const current: FeatureFlags = {
    ...DEFAULT_FEATURE_FLAGS,
    ...(org.featureFlags ? JSON.parse(org.featureFlags) : {}),
  }
  const updated = { ...current, ...input }
  await db
    .update(settings)
    .set({ featureFlags: JSON.stringify(updated) })
    .where(eq(settings.id, org.id))
  await invalidateSettingsCache()
  return updated
}
