import { db, eq, settings } from '@/lib/server/db'
import { NotFoundError, InternalError, ValidationError } from '@/lib/shared/errors'
import { getPublicUrlOrNull, deleteObject } from '@/lib/server/storage/s3'
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
  WidgetConfig,
  PublicWidgetConfig,
  UpdateWidgetConfigInput,
} from './settings.types'
import {
  DEFAULT_AUTH_CONFIG,
  DEFAULT_PORTAL_CONFIG,
  DEFAULT_DEVELOPER_CONFIG,
  DEFAULT_WIDGET_CONFIG,
} from './settings.types'
import { randomBytes } from 'crypto'

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

export async function getDeveloperConfig(): Promise<DeveloperConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.developerConfig, DEFAULT_DEVELOPER_CONFIG)
  } catch (error) {
    wrapDbError('fetch developer config', error)
  }
}

export async function updateDeveloperConfig(
  input: UpdateDeveloperConfigInput
): Promise<DeveloperConfig> {
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.developerConfig, DEFAULT_DEVELOPER_CONFIG)
    const updated = deepMerge(existing, input as Partial<DeveloperConfig>)
    await db
      .update(settings)
      .set({ developerConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
    return updated
  } catch (error) {
    wrapDbError('update developer config', error)
  }
}

// ============================================================================
// Widget Configuration
// ============================================================================

export async function getWidgetConfig(): Promise<WidgetConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)
  } catch (error) {
    wrapDbError('fetch widget config', error)
  }
}

export async function updateWidgetConfig(input: UpdateWidgetConfigInput): Promise<WidgetConfig> {
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)
    const updated = deepMerge(existing, input as Partial<WidgetConfig>)
    await db
      .update(settings)
      .set({ widgetConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
    return updated
  } catch (error) {
    wrapDbError('update widget config', error)
  }
}

export async function getPublicWidgetConfig(): Promise<PublicWidgetConfig> {
  try {
    const org = await requireSettings()
    const config = parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)
    return {
      enabled: config.enabled,
      defaultBoard: config.defaultBoard,
      position: config.position,
      buttonText: config.buttonText,
    }
  } catch (error) {
    wrapDbError('fetch public widget config', error)
  }
}

/** Generate a new widget secret: 'wgt_' + 32 random bytes (64 hex chars) */
export function generateWidgetSecret(): string {
  return 'wgt_' + randomBytes(32).toString('hex')
}

/** Get the widget secret (admin only — never expose in TenantSettings) */
export async function getWidgetSecret(): Promise<string | null> {
  try {
    const org = await requireSettings()
    return org.widgetSecret ?? null
  } catch (error) {
    wrapDbError('fetch widget secret', error)
  }
}

/** Regenerate the widget secret. Returns the new secret once. */
export async function regenerateWidgetSecret(): Promise<string> {
  try {
    const org = await requireSettings()
    const secret = generateWidgetSecret()
    await db.update(settings).set({ widgetSecret: secret }).where(eq(settings.id, org.id))
    return secret
  } catch (error) {
    wrapDbError('regenerate widget secret', error)
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

export async function getCustomCss(): Promise<string> {
  try {
    const org = await requireSettings()
    return org.customCss ?? ''
  } catch (error) {
    wrapDbError('fetch custom CSS', error)
  }
}

export async function updateCustomCss(css: string): Promise<string> {
  try {
    const org = await requireSettings()
    await db.update(settings).set({ customCss: css }).where(eq(settings.id, org.id))
    return css
  } catch (error) {
    wrapDbError('update custom CSS', error)
  }
}

// ============================================================================
// S3 Key Storage Functions
// ============================================================================

/**
 * Save logo S3 key and delete old image if exists.
 */
export async function saveLogoKey(key: string): Promise<{ success: true; key: string }> {
  try {
    const org = await requireSettings()

    // Delete old S3 image if exists
    if (org.logoKey) {
      try {
        await deleteObject(org.logoKey)
      } catch {
        // Ignore deletion errors - old file may not exist
      }
    }

    await db.update(settings).set({ logoKey: key }).where(eq(settings.id, org.id))

    return { success: true, key }
  } catch (error) {
    wrapDbError('save logo key', error)
  }
}

/**
 * Delete logo from S3 and clear the key.
 */
export async function deleteLogoKey(): Promise<{ success: true }> {
  try {
    const org = await requireSettings()

    if (org.logoKey) {
      try {
        await deleteObject(org.logoKey)
      } catch {
        // Ignore deletion errors
      }
    }

    await db.update(settings).set({ logoKey: null }).where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    wrapDbError('delete logo key', error)
  }
}

/**
 * Save favicon S3 key and delete old image if exists.
 */
export async function saveFaviconKey(key: string): Promise<{ success: true; key: string }> {
  try {
    const org = await requireSettings()

    if (org.faviconKey) {
      try {
        await deleteObject(org.faviconKey)
      } catch {
        // Ignore deletion errors
      }
    }

    await db.update(settings).set({ faviconKey: key }).where(eq(settings.id, org.id))

    return { success: true, key }
  } catch (error) {
    wrapDbError('save favicon key', error)
  }
}

/**
 * Delete favicon from S3 and clear the key.
 */
export async function deleteFaviconKey(): Promise<{ success: true }> {
  try {
    const org = await requireSettings()

    if (org.faviconKey) {
      try {
        await deleteObject(org.faviconKey)
      } catch {
        // Ignore deletion errors
      }
    }

    await db.update(settings).set({ faviconKey: null }).where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    wrapDbError('delete favicon key', error)
  }
}

/**
 * Save header logo S3 key and delete old image if exists.
 */
export async function saveHeaderLogoKey(key: string): Promise<{ success: true; key: string }> {
  try {
    const org = await requireSettings()

    if (org.headerLogoKey) {
      try {
        await deleteObject(org.headerLogoKey)
      } catch {
        // Ignore deletion errors
      }
    }

    await db.update(settings).set({ headerLogoKey: key }).where(eq(settings.id, org.id))

    return { success: true, key }
  } catch (error) {
    wrapDbError('save header logo key', error)
  }
}

/**
 * Delete header logo from S3 and clear the key.
 */
export async function deleteHeaderLogoKey(): Promise<{ success: true }> {
  try {
    const org = await requireSettings()

    if (org.headerLogoKey) {
      try {
        await deleteObject(org.headerLogoKey)
      } catch {
        // Ignore deletion errors
      }
    }

    await db.update(settings).set({ headerLogoKey: null }).where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    wrapDbError('delete header logo key', error)
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
  developerConfig: DeveloperConfig
  /** Custom CSS for portal styling */
  customCss: string
  publicAuthConfig: PublicAuthConfig
  publicPortalConfig: PublicPortalConfig
  /** Public widget config (no secret, safe for client) */
  publicWidgetConfig: PublicWidgetConfig
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
    const developerConfig = parseJsonConfig(org.developerConfig, DEFAULT_DEVELOPER_CONFIG)

    const widgetConfig = parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)

    const brandingData: SettingsBrandingData = {
      name: org.name,
      logoUrl: getPublicUrlOrNull(org.logoKey),
      faviconUrl: getPublicUrlOrNull(org.faviconKey),
      headerLogoUrl: getPublicUrlOrNull(org.headerLogoKey),
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
      developerConfig,
      customCss: org.customCss ?? '',
      publicAuthConfig: { oauth: authConfig.oauth, openSignup: authConfig.openSignup },
      publicPortalConfig: {
        oauth: portalConfig.oauth,
        features: portalConfig.features,
      },
      publicWidgetConfig: {
        enabled: widgetConfig.enabled,
        defaultBoard: widgetConfig.defaultBoard,
        position: widgetConfig.position,
        buttonText: widgetConfig.buttonText,
      },
      brandingData,
      faviconData: brandingData.faviconUrl ? { url: brandingData.faviconUrl } : null,
    }
  } catch (error) {
    wrapDbError('fetch settings with all configs', error)
  }
}
