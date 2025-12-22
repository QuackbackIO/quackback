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
import type { ServiceContext } from '../shared/service-context'
import { ok, err, type Result } from '../shared/result'
import { SettingsError } from './settings.errors'
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
 * Service class for settings domain operations
 */
export class SettingsService {
  /**
   * Get the singleton settings record
   */
  private async getSettings() {
    return db.query.settings.findFirst()
  }

  // ============================================
  // AUTH CONFIGURATION (Team sign-in)
  // ============================================

  /**
   * Get auth configuration
   * Public method - no auth required
   */
  async getAuthConfig(): Promise<Result<AuthConfig, SettingsError>> {
    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
      }

      const config = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)
      return ok(config)
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to fetch auth config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update auth configuration
   * Requires owner or admin role
   */
  async updateAuthConfig(
    input: UpdateAuthConfigInput,
    ctx: ServiceContext
  ): Promise<Result<AuthConfig, SettingsError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('update auth config'))
    }

    try {
      // Get existing config
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
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
        return err(SettingsError.notFound())
      }

      return ok(updated)
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to update auth config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
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
  async getPortalConfig(): Promise<Result<PortalConfig, SettingsError>> {
    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
      }

      const config = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)
      return ok(config)
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to fetch portal config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update portal configuration
   * Requires owner or admin role
   */
  async updatePortalConfig(
    input: UpdatePortalConfigInput,
    ctx: ServiceContext
  ): Promise<Result<PortalConfig, SettingsError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('update portal config'))
    }

    try {
      // Get existing config
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
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
        return err(SettingsError.notFound())
      }

      return ok(updated)
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to update portal config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
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
  async getBrandingConfig(): Promise<Result<BrandingConfig, SettingsError>> {
    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
      }

      const config = parseJsonConfigNullable<BrandingConfig>(org.brandingConfig) || {}
      return ok(config)
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to fetch branding config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update branding configuration
   * Requires owner or admin role
   */
  async updateBrandingConfig(
    config: BrandingConfig,
    ctx: ServiceContext
  ): Promise<Result<BrandingConfig, SettingsError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('update branding config'))
    }

    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
      }

      const [updated] = await db
        .update(settings)
        .set({ brandingConfig: JSON.stringify(config) })
        .where(eq(settings.id, org.id))
        .returning()

      if (!updated) {
        return err(SettingsError.notFound())
      }

      return ok(config)
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to update branding config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
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
  async getCustomCss(): Promise<Result<string | null, SettingsError>> {
    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
      }

      return ok(org.customCss)
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to fetch custom CSS: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update custom CSS
   * Requires owner or admin role
   */
  async updateCustomCss(
    css: string | null,
    ctx: ServiceContext
  ): Promise<Result<string | null, SettingsError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('update custom CSS'))
    }

    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
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
        return err(SettingsError.notFound())
      }

      return ok(updated.customCss)
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to update custom CSS: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // LOGO MANAGEMENT
  // ============================================

  /**
   * Upload logo (square logo for favicon and compact display)
   * Requires owner or admin role
   */
  async uploadLogo(
    data: { blob: Buffer; mimeType: string },
    ctx: ServiceContext
  ): Promise<Result<{ success: true }, SettingsError>> {
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('upload logo'))
    }

    try {
      const org = await this.getSettings()
      if (!org) {
        return err(SettingsError.notFound())
      }

      await db
        .update(settings)
        .set({
          logoBlob: data.blob,
          logoType: data.mimeType,
        })
        .where(eq(settings.id, org.id))

      return ok({ success: true })
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to upload logo: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Delete logo
   * Requires owner or admin role
   */
  async deleteLogo(ctx: ServiceContext): Promise<Result<{ success: true }, SettingsError>> {
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('delete logo'))
    }

    try {
      const org = await this.getSettings()
      if (!org) {
        return err(SettingsError.notFound())
      }

      await db
        .update(settings)
        .set({
          logoBlob: null,
          logoType: null,
        })
        .where(eq(settings.id, org.id))

      return ok({ success: true })
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to delete logo: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Upload header logo (horizontal wordmark/lockup)
   * Requires owner or admin role
   */
  async uploadHeaderLogo(
    data: { blob: Buffer; mimeType: string },
    ctx: ServiceContext
  ): Promise<Result<{ success: true }, SettingsError>> {
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('upload header logo'))
    }

    try {
      const org = await this.getSettings()
      if (!org) {
        return err(SettingsError.notFound())
      }

      await db
        .update(settings)
        .set({
          headerLogoBlob: data.blob,
          headerLogoType: data.mimeType,
        })
        .where(eq(settings.id, org.id))

      return ok({ success: true })
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to upload header logo: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Delete header logo
   * Requires owner or admin role
   */
  async deleteHeaderLogo(ctx: ServiceContext): Promise<Result<{ success: true }, SettingsError>> {
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('delete header logo'))
    }

    try {
      const org = await this.getSettings()
      if (!org) {
        return err(SettingsError.notFound())
      }

      await db
        .update(settings)
        .set({
          headerLogoBlob: null,
          headerLogoType: null,
        })
        .where(eq(settings.id, org.id))

      return ok({ success: true })
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to delete header logo: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  // ============================================
  // HEADER DISPLAY SETTINGS
  // ============================================

  /**
   * Update header display mode
   * Requires owner or admin role
   */
  async updateHeaderDisplayMode(
    mode: string,
    ctx: ServiceContext
  ): Promise<Result<string, SettingsError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('update header display mode'))
    }

    // Validate mode
    const validModes = ['logo_and_name', 'logo_only', 'custom_logo']
    if (!validModes.includes(mode)) {
      return err(SettingsError.validationError(`Invalid header display mode: ${mode}`))
    }

    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
      }

      const [updated] = await db
        .update(settings)
        .set({ headerDisplayMode: mode })
        .where(eq(settings.id, org.id))
        .returning({ headerDisplayMode: settings.headerDisplayMode })

      if (!updated) {
        return err(SettingsError.notFound())
      }

      return ok(updated.headerDisplayMode || 'logo_and_name')
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to update header display mode: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Update header display name
   * Requires owner or admin role
   */
  async updateHeaderDisplayName(
    name: string | null,
    ctx: ServiceContext
  ): Promise<Result<string | null, SettingsError>> {
    // Authorization check
    if (!['owner', 'admin'].includes(ctx.memberRole)) {
      return err(SettingsError.unauthorized('update header display name'))
    }

    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
      }

      // Trim and sanitize name
      const sanitizedName = name?.trim() || null

      const [updated] = await db
        .update(settings)
        .set({ headerDisplayName: sanitizedName })
        .where(eq(settings.id, org.id))
        .returning({ headerDisplayName: settings.headerDisplayName })

      if (!updated) {
        return err(SettingsError.notFound())
      }

      return ok(updated.headerDisplayName)
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to update header display name: ${error instanceof Error ? error.message : 'Unknown error'}`
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
  async getPublicAuthConfig(): Promise<Result<PublicAuthConfig, SettingsError>> {
    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
      }

      const authConfig = parseJsonConfig(org.authConfig, DEFAULT_AUTH_CONFIG)

      return ok({
        oauth: authConfig.oauth,
        openSignup: authConfig.openSignup,
      })
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to fetch public auth config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }

  /**
   * Get public portal configuration
   * No authentication required - returns only non-sensitive information
   */
  async getPublicPortalConfig(): Promise<Result<PublicPortalConfig, SettingsError>> {
    try {
      const org = await this.getSettings()

      if (!org) {
        return err(SettingsError.notFound())
      }

      const portalConfig = parseJsonConfig(org.portalConfig, DEFAULT_PORTAL_CONFIG)

      return ok({
        oauth: portalConfig.oauth,
        features: portalConfig.features,
      })
    } catch (error) {
      return err(
        SettingsError.validationError(
          `Failed to fetch portal config: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      )
    }
  }
}

/**
 * Singleton instance of SettingsService
 */
export const settingsService = new SettingsService()

// Backwards compatibility aliases
export const WorkspaceService = SettingsService
export const workspaceService = settingsService
