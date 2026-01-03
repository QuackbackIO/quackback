/**
 * SettingsService - Business logic for app settings
 *
 * This service handles all settings-related business logic including:
 * - Auth configuration (team sign-in settings)
 * - Portal configuration (public portal settings)
 * - Branding configuration (theme/colors)
 * - Custom CSS
 */

import { db, eq, settings } from '@quackback/db'
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
 * Get the singleton settings record
 */
async function getSettings() {
  return db.query.settings.findFirst()
}

// ============================================
// AUTH CONFIGURATION (Team sign-in)
// ============================================

/**
 * Get auth configuration
 * Public method - no auth required
 */
export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    const config = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
    return config
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch auth config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Update auth configuration
 */
export async function updateAuthConfig(input: UpdateAuthConfigInput): Promise<AuthConfig> {
  try {
    // Get existing config
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    const existing = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)

    // Deep merge the updates
    const updated = deepMerge(existing, input as Partial<AuthConfig>)

    const [result] = await db
      .update(settings)
      .set({ authConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
      .returning()

    if (!result) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    return updated
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to update auth config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

// ============================================
// PORTAL CONFIGURATION
// ============================================

/**
 * Get portal configuration
 * Public method - no auth required
 */
export async function getPortalConfig(): Promise<PortalConfig> {
  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    const config = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
    return config
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch portal config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Update portal configuration
 */
export async function updatePortalConfig(input: UpdatePortalConfigInput): Promise<PortalConfig> {
  try {
    // Get existing config
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    const existing = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

    // Deep merge the updates
    const updated = deepMerge(existing, input as Partial<PortalConfig>)

    const [result] = await db
      .update(settings)
      .set({ portalConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
      .returning()

    if (!result) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    return updated
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to update portal config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

// ============================================
// BRANDING CONFIGURATION
// ============================================

/**
 * Get branding configuration
 * Public method - no auth required
 */
export async function getBrandingConfig(): Promise<BrandingConfig> {
  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    const config = parseJsonConfigNullable<BrandingConfig>(org.brandingConfig) || {}
    return config
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch branding config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Update branding configuration
 */
export async function updateBrandingConfig(config: BrandingConfig): Promise<BrandingConfig> {
  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    const [updated] = await db
      .update(settings)
      .set({ brandingConfig: JSON.stringify(config) })
      .where(eq(settings.id, org.id))
      .returning()

    if (!updated) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    return config
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to update branding config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

// ============================================
// CUSTOM CSS
// ============================================

/**
 * Get custom CSS
 * Public method - no auth required
 */
export async function getCustomCss(): Promise<string | null> {
  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    return org.customCss
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch custom CSS: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Update custom CSS
 */
export async function updateCustomCss(css: string | null): Promise<string | null> {
  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

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
      .update(settings)
      .set({ customCss: sanitized })
      .where(eq(settings.id, org.id))
      .returning({ customCss: settings.customCss })

    if (!updated) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    return updated.customCss
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to update custom CSS: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

// ============================================
// LOGO MANAGEMENT
// ============================================

/**
 * Upload logo (square logo for favicon and compact display)
 */
export async function uploadLogo(data: {
  blob: Buffer
  mimeType: string
}): Promise<{ success: true }> {
  try {
    const org = await getSettings()
    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    await db
      .update(settings)
      .set({
        logoBlob: data.blob,
        logoType: data.mimeType,
      })
      .where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to upload logo: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Delete logo
 */
export async function deleteLogo(): Promise<{ success: true }> {
  try {
    const org = await getSettings()
    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    await db
      .update(settings)
      .set({
        logoBlob: null,
        logoType: null,
      })
      .where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to delete logo: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Upload header logo (horizontal wordmark/lockup)
 */
export async function uploadHeaderLogo(data: {
  blob: Buffer
  mimeType: string
}): Promise<{ success: true }> {
  try {
    const org = await getSettings()
    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    await db
      .update(settings)
      .set({
        headerLogoBlob: data.blob,
        headerLogoType: data.mimeType,
      })
      .where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to upload header logo: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Delete header logo
 */
export async function deleteHeaderLogo(): Promise<{ success: true }> {
  try {
    const org = await getSettings()
    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    await db
      .update(settings)
      .set({
        headerLogoBlob: null,
        headerLogoType: null,
      })
      .where(eq(settings.id, org.id))

    return { success: true }
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to delete header logo: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

// ============================================
// HEADER DISPLAY SETTINGS
// ============================================

/**
 * Update header display mode
 */
export async function updateHeaderDisplayMode(mode: string): Promise<string> {
  // Validate mode
  const validModes = ['logo_and_name', 'logo_only', 'custom_logo']
  if (!validModes.includes(mode)) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid header display mode: ${mode}`)
  }

  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    const [updated] = await db
      .update(settings)
      .set({ headerDisplayMode: mode })
      .where(eq(settings.id, org.id))
      .returning({ headerDisplayMode: settings.headerDisplayMode })

    if (!updated) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    return updated.headerDisplayMode || 'logo_and_name'
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to update header display mode: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Update header display name
 */
export async function updateHeaderDisplayName(name: string | null): Promise<string | null> {
  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    // Trim and sanitize name
    const sanitizedName = name?.trim() || null

    const [updated] = await db
      .update(settings)
      .set({ headerDisplayName: sanitizedName })
      .where(eq(settings.id, org.id))
      .returning({ headerDisplayName: settings.headerDisplayName })

    if (!updated) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    return updated.headerDisplayName
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to update header display name: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
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
export async function getPublicAuthConfig(): Promise<PublicAuthConfig> {
  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)

    return {
      oauth: authConfig.oauth,
      openSignup: authConfig.openSignup,
    }
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch public auth config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}

/**
 * Get public portal configuration
 * No authentication required - returns only non-sensitive information
 */
export async function getPublicPortalConfig(): Promise<PublicPortalConfig> {
  try {
    const org = await getSettings()

    if (!org) {
      throw new NotFoundError('SETTINGS_NOT_FOUND', 'Settings not found')
    }

    const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

    return {
      oauth: portalConfig.oauth,
      features: portalConfig.features,
    }
  } catch (error) {
    if (error instanceof NotFoundError) throw error
    throw new InternalError(
      'DATABASE_ERROR',
      `Failed to fetch portal config: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error
    )
  }
}
