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
} from './settings.types'
import { DEFAULT_AUTH_CONFIG, DEFAULT_PORTAL_CONFIG } from './settings.types'

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

function parseJsonConfigNullable<T>(json: string | null): T | null {
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
    return parseJsonConfigNullable<BrandingConfig>(org.brandingConfig) || {}
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
    }
  } catch (error) {
    wrapDbError('fetch public portal config', error)
  }
}
