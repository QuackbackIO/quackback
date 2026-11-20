import { db, eq, settings } from '@/lib/server/db'
import { deleteObject } from '@/lib/server/storage/s3'
import { ValidationError } from '@/lib/shared/errors'
import { advancedCssRemainder } from '@/lib/shared/theme/readable-css'
import { assertNotManaged } from '@/lib/server/config-file/managed-guard'
import { logger } from '@/lib/server/logger'
import type { BrandingConfig } from './settings.types'
import {
  requireSettings,
  requireSettingsCached,
  wrapDbError,
  parseJsonOrNull,
  invalidateSettingsCache,
  writeLockedSettings,
  type SettingsWriteOptions,
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

export async function updateBrandingConfig(
  config: BrandingConfig,
  options: SettingsWriteOptions = {}
): Promise<BrandingConfig> {
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

    const org = await requireSettings(options.executor)
    await (options.executor ?? db)
      .update(settings)
      .set({ brandingConfig: JSON.stringify(config) })
      .where(eq(settings.id, org.id))
    if (!options.executor) await invalidateSettingsCache()
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

export async function updateCustomCss(
  css: string,
  options: SettingsWriteOptions = {}
): Promise<string> {
  log.info('update custom css')
  try {
    if (css.includes('<')) {
      throw new ValidationError('INVALID_CUSTOM_CSS', 'Custom CSS cannot contain the "<" character')
    }
    await writeLockedSettings(options, async (tx, org) => {
      const trimmed = css.trim()
      // Empty is always allowed so a workspace whose tier just stopped including
      // custom CSS can wipe it. Stripping generated theme declarations from CSS
      // already stored is also ungated — that rewrite cannot introduce extra
      // rules. Any other non-empty write hits the feature gate.
      if (trimmed.length > 0 && trimmed !== advancedCssRemainder(org.customCss ?? '')) {
        const { assertTierFeature } = await import('./tier-enforce')
        await assertTierFeature('customCss', 'Custom CSS')
      }
      await tx.update(settings).set({ customCss: css }).where(eq(settings.id, org.id))
    })
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
 * Save the logo key while retaining the previous image for Undo.
 */
export async function saveLogoKey(
  key: string,
  options: SettingsWriteOptions = {}
): Promise<{ success: true; key: string }> {
  log.info('save logo key')
  try {
    const org = await requireSettings(options.executor)

    // Previous assets remain available for a later settings Undo.

    await (options.executor ?? db)
      .update(settings)
      .set({ logoKey: key })
      .where(eq(settings.id, org.id))
    if (!options.executor) await invalidateSettingsCache()

    return { success: true, key }
  } catch (error) {
    log.error({ err: error }, 'save logo key failed')
    wrapDbError('save logo key', error)
  }
}

/**
 * Delete logo from S3 and clear the key. The favicon is derived from the
 * logo at upload, so removing the logo clears both keys.
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
    if (org.faviconKey) {
      try {
        await deleteObject(org.faviconKey)
      } catch (err) {
        log.warn({ err, favicon_key: org.faviconKey }, 'failed to delete favicon s3 object')
      }
    }

    await db
      .update(settings)
      .set({ logoKey: null, faviconKey: null })
      .where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true }
  } catch (error) {
    log.error({ err: error }, 'delete logo key failed')
    wrapDbError('delete logo key', error)
  }
}

/**
 * Save the favicon key while retaining the previous image for Undo.
 */
export async function saveFaviconKey(
  key: string,
  options: SettingsWriteOptions = {}
): Promise<{ success: true; key: string }> {
  log.info('save favicon key')
  try {
    const org = await requireSettings(options.executor)

    // Previous assets remain available for a later settings Undo.

    await (options.executor ?? db)
      .update(settings)
      .set({ faviconKey: key })
      .where(eq(settings.id, org.id))
    if (!options.executor) await invalidateSettingsCache()

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
 * Save the header logo key under the row lock. The previous image is deleted
 * only once the new key is committed: here after the write's own transaction,
 * or, with an executor, by the caller after its commit (from `previousKey`).
 */
export async function saveHeaderLogoKey(
  key: string,
  options: SettingsWriteOptions = {}
): Promise<{ success: true; key: string; previousKey: string | null }> {
  log.info('save header logo key')
  try {
    const previousKey = await writeLockedSettings(options, async (tx, org) => {
      await tx.update(settings).set({ headerLogoKey: key }).where(eq(settings.id, org.id))
      return org.headerLogoKey
    })
    if (!options.executor && previousKey && previousKey !== key)
      await deleteHeaderLogoObject(previousKey)
    return { success: true, key, previousKey }
  } catch (error) {
    log.error({ err: error }, 'save header logo key failed')
    wrapDbError('save header logo key', error)
  }
}

/**
 * Clear the header logo key under the row lock, then delete the image (with
 * an executor, the caller deletes `previousKey` after its commit).
 */
export async function deleteHeaderLogoKey(
  options: SettingsWriteOptions = {}
): Promise<{ success: true; previousKey: string | null }> {
  log.info('delete header logo key')
  try {
    const previousKey = await writeLockedSettings(options, async (tx, org) => {
      await tx.update(settings).set({ headerLogoKey: null }).where(eq(settings.id, org.id))
      return org.headerLogoKey
    })
    if (!options.executor && previousKey) await deleteHeaderLogoObject(previousKey)
    return { success: true, previousKey }
  } catch (error) {
    log.error({ err: error }, 'delete header logo key failed')
    wrapDbError('delete header logo key', error)
  }
}

/**
 * Set or clear (null) the header logo's dark mode version, under the row
 * lock. It is kept with the portal's settings, one key among them, so every
 * other key is carried. The file it replaces is never deleted here: the
 * caller leaves it for the staged-uploads sweep, as a replaced logo is left.
 */
export async function saveHeaderLogoDarkKey(
  key: string | null,
  options: SettingsWriteOptions = {}
): Promise<{ success: true; previousKey: string | null }> {
  log.info({ cleared: key === null }, 'save header logo dark key')
  try {
    const previousKey = await writeLockedSettings(options, async (tx, org) => {
      // The stored text as it is, never the parsed config: its defaults are not written back.
      const stored = parseJsonOrNull<Record<string, unknown>>(org.portalConfig)
      const config = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
      const { headerLogoDarkKey: previous, ...rest } = config
      const next = key === null ? rest : { ...rest, headerLogoDarkKey: key }
      await tx
        .update(settings)
        .set({ portalConfig: JSON.stringify(next) })
        .where(eq(settings.id, org.id))
      return typeof previous === 'string' ? previous : null
    })
    return { success: true, previousKey }
  } catch (error) {
    log.error({ err: error }, 'save header logo dark key failed')
    wrapDbError('save header logo dark key', error)
  }
}

async function deleteHeaderLogoObject(key: string): Promise<void> {
  try {
    await deleteObject(key)
  } catch (err) {
    log.warn({ err, header_logo_key: key }, 'failed to delete old header logo s3 object')
  }
}

// ============================================================================
// Header Display
// ============================================================================

const VALID_HEADER_MODES = ['logo_and_name', 'logo_only', 'custom_logo'] as const

export async function updateHeaderDisplayMode(
  mode: string,
  options: SettingsWriteOptions = {}
): Promise<string> {
  log.info({ mode }, 'update header display mode')
  if (!VALID_HEADER_MODES.includes(mode as (typeof VALID_HEADER_MODES)[number])) {
    throw new ValidationError('VALIDATION_ERROR', `Invalid header display mode: ${mode}`)
  }

  try {
    const org = await requireSettings(options.executor)
    const [updated] = await (options.executor ?? db)
      .update(settings)
      .set({ headerDisplayMode: mode })
      .where(eq(settings.id, org.id))
      .returning()

    if (!options.executor) await invalidateSettingsCache()
    return updated?.headerDisplayMode || 'logo_and_name'
  } catch (error) {
    log.error({ err: error }, 'update header display mode failed')
    wrapDbError('update header display mode', error)
  }
}

export async function updateHeaderDisplayName(
  name: string | null,
  options: SettingsWriteOptions = {}
): Promise<string | null> {
  log.info('update header display name')
  try {
    const org = await requireSettings(options.executor)
    const sanitizedName = name?.trim() || null

    const [updated] = await (options.executor ?? db)
      .update(settings)
      .set({ headerDisplayName: sanitizedName })
      .where(eq(settings.id, org.id))
      .returning()

    if (!options.executor) await invalidateSettingsCache()
    return updated?.headerDisplayName ?? null
  } catch (error) {
    log.error({ err: error }, 'update header display name failed')
    wrapDbError('update header display name', error)
  }
}

export async function updateWorkspaceName(
  name: string,
  options: SettingsWriteOptions = {}
): Promise<string> {
  log.info('update workspace name')
  try {
    await assertNotManaged('workspace.name')
    const org = await requireSettings(options.executor)
    const sanitizedName = name.trim()
    if (!sanitizedName) throw new ValidationError('INVALID_NAME', 'Workspace name cannot be empty')

    const [updated] = await (options.executor ?? db)
      .update(settings)
      .set({ name: sanitizedName })
      .where(eq(settings.id, org.id))
      .returning()
    if (!options.executor) await invalidateSettingsCache()
    return updated?.name ?? sanitizedName
  } catch (error) {
    log.error({ err: error }, 'update workspace name failed')
    wrapDbError('update workspace name', error)
  }
}
