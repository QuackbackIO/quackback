import { db, eq, settings } from '@/lib/server/db'
import { NotFoundError, InternalError, ValidationError } from '@/lib/shared/errors'
import type {
  AuthConfig,
  UpdateAuthConfigInput,
  PortalConfig,
  UpdatePortalConfigInput,
  BrandingConfig,
  PublicAuthConfig,
  PublicPortalConfig,
} from './settings.types'
import { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from './settings.types'

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

async function requireSettings(): Promise<SettingsRecord> {
  const org = await db.query.settings.findFirst()
  if (!org) throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
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

    const hasAuthMethod = updated.oauth.email || updated.oauth.github || updated.oauth.google
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
    }
  } catch (error) {
    wrapDbError('fetch public portal config', error)
  }
}

function blobToDataUrl(blob: Buffer | null, mimeType: string | null): string | null {
  if (!blob || !mimeType) return null
  return `data:${mimeType};base64,${Buffer.from(blob).toString('base64')}`
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
    const org = await db.query.settings.findFirst()
    if (!org) return null

    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    const brandingConfig = parseJsonOrNull<BrandingConfig>(org.brandingConfig) ?? {}

    const brandingData: SettingsBrandingData = {
      name: org.name,
      logoUrl: blobToDataUrl(org.logoBlob, org.logoType),
      faviconUrl: blobToDataUrl(org.faviconBlob, org.faviconType),
      headerLogoUrl: blobToDataUrl(org.headerLogoBlob, org.headerLogoType),
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
      },
      brandingData,
      faviconData: brandingData.faviconUrl ? { url: brandingData.faviconUrl } : null,
    }
  } catch (error) {
    wrapDbError('fetch settings with all configs', error)
  }
}
