import { db, eq, settings } from '@/lib/server/db'
import { deleteObject } from '@/lib/server/storage/s3'
import { ValidationError } from '@/lib/shared/errors'
import { assertNotManaged } from '@/lib/server/config-file/managed-guard'
import { logger } from '@/lib/server/logger'
import type { BrandingConfig } from './settings.types'
import {
  requireSettings,
  requireSettingsCached,
  wrapDbError,
  parseJsonOrNull,
  invalidateSettingsCache,
} from './settings.helpers'

const log = logger.child({ component: 'settings-media' })

// ============================================================================
// Branding Config
// ============================================================================

export async function getBrandingConfig(): Promise<BrandingConfig> {
  try {
    // Read-only + on public hot paths (config.json, portal SSR): cached row.
    const org = await requireSettingsCached()
    return parseJsonOrNull<BrandingConfig>(org.brandingConfig) ?? {}
  } catch (error) {
    log.error({ err: error }, 'get branding config failed')
    wrapDbError('fetch branding config', error)
  }
}

export async function updateBrandingConfig(config: BrandingConfig): Promise<BrandingConfig> {
  log.info('update branding config')
  try {
    // Setting custom theme colors (light/dark overrides) is gated.
    // Preset and themeMode swaps don't count as colour customisation —
    // they pick from the curated set the workspace already has access to.
    const isCustomisingColors = config.light !== undefined || config.dark !== undefined
    if (isCustomisingColors) {
      const { assertTierFeature } = await import('./tier-enforce')
      await assertTierFeature('customColors', 'Custom colours')
    }

    const org = await requireSettings()
    await db
      .update(settings)
      .set({ brandingConfig: JSON.stringify(config) })
      .where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return config
  } catch (error) {
    log.error({ err: error }, 'update branding config failed')
    wrapDbError('update branding config', error)
  }
}

// ============================================================================
// Custom CSS
// ============================================================================

export async function getCustomCss(): Promise<string> {
  try {
    // Read-only + on public hot paths (config.json, portal SSR): cached row.
    const org = await requireSettingsCached()
    return org.customCss ?? ''
  } catch (error) {
    log.error({ err: error }, 'get custom css failed')
    wrapDbError('fetch custom CSS', error)
  }
}

export async function updateCustomCss(css: string): Promise<string> {
  log.info('update custom css')
  try {
    if (css.includes('<')) {
      throw new ValidationError('INVALID_CUSTOM_CSS', 'Custom CSS cannot contain the "<" character')
    }
    // Clearing CSS (empty string) is always allowed so a workspace whose
    // tier just stopped including custom CSS can wipe it without being
    // blocked. Anything non-empty hits the feature gate.
    if (css.trim().length > 0) {
      const { assertTierFeature } = await import('./tier-enforce')
      await assertTierFeature('customCss', 'Custom CSS')
    }

    const org = await requireSettings()
    await db.update(settings).set({ customCss: css }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return css
  } catch (error) {
    log.error({ err: error }, 'update custom css failed')
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
  log.info('save logo key')
  try {
    const org = await requireSettings()

    // Delete old S3 image if exists
    if (org.logoKey) {
      try {
        await deleteObject(org.logoKey)
      } catch (err) {
        log.warn({ err, logo_key: org.logoKey }, 'failed to delete old logo s3 object')
      }
    }

    await db.update(settings).set({ logoKey: key }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true, key }
  } catch (error) {
    log.error({ err: error }, 'save logo key failed')
    wrapDbError('save logo key', error)
  }
}

/**
 * Delete logo from S3 and clear the key.
 */
export async function deleteLogoKey(): Promise<{ success: true }> {
  log.info('delete logo key')
  try {
    const org = await requireSettings()

    if (org.logoKey) {
      try {
        await deleteObject(org.logoKey)
      } catch (err) {
        log.warn({ err, logo_key: org.logoKey }, 'failed to delete logo s3 object')
      }
    }

    await db.update(settings).set({ logoKey: null }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true }
  } catch (error) {
    log.error({ err: error }, 'delete logo key failed')
    wrapDbError('delete logo key', error)
  }
}

/**
 * Save favicon S3 key and delete old image if exists.
 */
export async function saveFaviconKey(key: string): Promise<{ success: true; key: string }> {
  log.info('save favicon key')
  try {
    const org = await requireSettings()

    if (org.faviconKey) {
      try {
        await deleteObject(org.faviconKey)
      } catch (err) {
        log.warn({ err, favicon_key: org.faviconKey }, 'failed to delete old favicon s3 object')
      }
    }

    await db.update(settings).set({ faviconKey: key }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true, key }
  } catch (error) {
    log.error({ err: error }, 'save favicon key failed')
    wrapDbError('save favicon key', error)
  }
}

/**
 * Delete favicon from S3 and clear the key.
 */
export async function deleteFaviconKey(): Promise<{ success: true }> {
  log.info('delete favicon key')
  try {
    const org = await requireSettings()

    if (org.faviconKey) {
      try {
        await deleteObject(org.faviconKey)
      } catch (err) {
        log.warn({ err, favicon_key: org.faviconKey }, 'failed to delete favicon s3 object')
      }
    }

    await db.update(settings).set({ faviconKey: null }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true }
  } catch (error) {
    log.error({ err: error }, 'delete favicon key failed')
    wrapDbError('delete favicon key', error)
  }
}

/**
 * Save header logo S3 key and delete old image if exists.
 */
export async function saveHeaderLogoKey(key: string): Promise<{ success: true; key: string }> {
  log.info('save header logo key')
  try {
    const org = await requireSettings()

    if (org.headerLogoKey) {
      try {
        await deleteObject(org.headerLogoKey)
      } catch (err) {
        log.warn(
          { err, header_logo_key: org.headerLogoKey },
          'failed to delete old header logo s3 object'
        )
      }
    }

    await db.update(settings).set({ headerLogoKey: key }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true, key }
  } catch (error) {
    log.error({ err: error }, 'save header logo key failed')
    wrapDbError('save header logo key', error)
  }
}

/**
 * Delete header logo from S3 and clear the key.
 */
export async function deleteHeaderLogoKey(): Promise<{ success: true }> {
  log.info('delete header logo key')
  try {
    const org = await requireSettings()

    if (org.headerLogoKey) {
      try {
        await deleteObject(org.headerLogoKey)
      } catch (err) {
        log.warn(
          { err, header_logo_key: org.headerLogoKey },
          'failed to delete header logo s3 object'
        )
      }
    }

    await db.update(settings).set({ headerLogoKey: null }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true }
  } catch (error) {
    log.error({ err: error }, 'delete header logo key failed')
    wrapDbError('delete header logo key', error)
  }
}

// ============================================================================
// Header Display
// ============================================================================

const VALID_HEADER_MODES = ['logo_and_name', 'logo_only', 'custom_logo'] as const

export async function updateHeaderDisplayMode(mode: string): Promise<string> {
  log.info({ mode }, 'update header display mode')
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

    await invalidateSettingsCache()
    return updated?.headerDisplayMode || 'logo_and_name'
  } catch (error) {
    log.error({ err: error }, 'update header display mode failed')
    wrapDbError('update header display mode', error)
  }
}

export async function updateHeaderDisplayName(name: string | null): Promise<string | null> {
  log.info('update header display name')
  try {
    const org = await requireSettings()
    const sanitizedName = name?.trim() || null

    const [updated] = await db
      .update(settings)
      .set({ headerDisplayName: sanitizedName })
      .where(eq(settings.id, org.id))
      .returning()

    await invalidateSettingsCache()
    return updated?.headerDisplayName ?? null
  } catch (error) {
    log.error({ err: error }, 'update header display name failed')
    wrapDbError('update header display name', error)
  }
}

export async function updateWorkspaceName(name: string): Promise<string> {
  log.info('update workspace name')
  try {
    await assertNotManaged('workspace.name')
    const org = await requireSettings()
    const sanitizedName = name.trim()
    if (!sanitizedName) throw new ValidationError('INVALID_NAME', 'Workspace name cannot be empty')

    const [updated] = await db
      .update(settings)
      .set({ name: sanitizedName })
      .where(eq(settings.id, org.id))
      .returning()
    await invalidateSettingsCache()
    return updated?.name ?? sanitizedName
  } catch (error) {
    log.error({ err: error }, 'update workspace name failed')
    wrapDbError('update workspace name', error)
  }
}
