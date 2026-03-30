import { db, eq, settings } from '@/lib/server/db'
import { deleteObject } from '@/lib/server/storage/s3'
import { ValidationError } from '@/lib/shared/errors'
import type { BrandingConfig } from './settings.types'
import {
  requireSettings,
  wrapDbError,
  parseJsonOrNull,
  invalidateSettingsCache,
} from './settings.helpers'

// ============================================================================
// Branding Config
// ============================================================================

export async function getBrandingConfig(): Promise<BrandingConfig> {
  try {
    const org = await requireSettings()
    return parseJsonOrNull<BrandingConfig>(org.brandingConfig) ?? {}
  } catch (error) {
    console.error(`[domain:settings] getBrandingConfig failed:`, error)
    wrapDbError('fetch branding config', error)
  }
}

export async function updateBrandingConfig(config: BrandingConfig): Promise<BrandingConfig> {
  console.log(`[domain:settings] updateBrandingConfig`)
  try {
    const org = await requireSettings()
    await db
      .update(settings)
      .set({ brandingConfig: JSON.stringify(config) })
      .where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return config
  } catch (error) {
    console.error(`[domain:settings] updateBrandingConfig failed:`, error)
    wrapDbError('update branding config', error)
  }
}

// ============================================================================
// Custom CSS
// ============================================================================

export async function getCustomCss(): Promise<string> {
  try {
    const org = await requireSettings()
    return org.customCss ?? ''
  } catch (error) {
    console.error(`[domain:settings] getCustomCss failed:`, error)
    wrapDbError('fetch custom CSS', error)
  }
}

export async function updateCustomCss(css: string): Promise<string> {
  console.log(`[domain:settings] updateCustomCss`)
  try {
    const org = await requireSettings()
    await db.update(settings).set({ customCss: css }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return css
  } catch (error) {
    console.error(`[domain:settings] updateCustomCss failed:`, error)
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
  console.log(`[domain:settings] saveLogoKey`)
  try {
    const org = await requireSettings()

    // Delete old S3 image if exists
    if (org.logoKey) {
      try {
        await deleteObject(org.logoKey)
      } catch (err) {
        console.warn(`[domain:settings] Failed to delete old logo S3 object ${org.logoKey}:`, err)
      }
    }

    await db.update(settings).set({ logoKey: key }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true, key }
  } catch (error) {
    console.error(`[domain:settings] saveLogoKey failed:`, error)
    wrapDbError('save logo key', error)
  }
}

/**
 * Delete logo from S3 and clear the key.
 */
export async function deleteLogoKey(): Promise<{ success: true }> {
  console.log(`[domain:settings] deleteLogoKey`)
  try {
    const org = await requireSettings()

    if (org.logoKey) {
      try {
        await deleteObject(org.logoKey)
      } catch (err) {
        console.warn(`[domain:settings] Failed to delete logo S3 object ${org.logoKey}:`, err)
      }
    }

    await db.update(settings).set({ logoKey: null }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true }
  } catch (error) {
    console.error(`[domain:settings] deleteLogoKey failed:`, error)
    wrapDbError('delete logo key', error)
  }
}

/**
 * Save favicon S3 key and delete old image if exists.
 */
export async function saveFaviconKey(key: string): Promise<{ success: true; key: string }> {
  console.log(`[domain:settings] saveFaviconKey`)
  try {
    const org = await requireSettings()

    if (org.faviconKey) {
      try {
        await deleteObject(org.faviconKey)
      } catch (err) {
        console.warn(
          `[domain:settings] Failed to delete old favicon S3 object ${org.faviconKey}:`,
          err
        )
      }
    }

    await db.update(settings).set({ faviconKey: key }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true, key }
  } catch (error) {
    console.error(`[domain:settings] saveFaviconKey failed:`, error)
    wrapDbError('save favicon key', error)
  }
}

/**
 * Delete favicon from S3 and clear the key.
 */
export async function deleteFaviconKey(): Promise<{ success: true }> {
  console.log(`[domain:settings] deleteFaviconKey`)
  try {
    const org = await requireSettings()

    if (org.faviconKey) {
      try {
        await deleteObject(org.faviconKey)
      } catch (err) {
        console.warn(`[domain:settings] Failed to delete favicon S3 object ${org.faviconKey}:`, err)
      }
    }

    await db.update(settings).set({ faviconKey: null }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true }
  } catch (error) {
    console.error(`[domain:settings] deleteFaviconKey failed:`, error)
    wrapDbError('delete favicon key', error)
  }
}

/**
 * Save header logo S3 key and delete old image if exists.
 */
export async function saveHeaderLogoKey(key: string): Promise<{ success: true; key: string }> {
  console.log(`[domain:settings] saveHeaderLogoKey`)
  try {
    const org = await requireSettings()

    if (org.headerLogoKey) {
      try {
        await deleteObject(org.headerLogoKey)
      } catch (err) {
        console.warn(
          `[domain:settings] Failed to delete old header logo S3 object ${org.headerLogoKey}:`,
          err
        )
      }
    }

    await db.update(settings).set({ headerLogoKey: key }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true, key }
  } catch (error) {
    console.error(`[domain:settings] saveHeaderLogoKey failed:`, error)
    wrapDbError('save header logo key', error)
  }
}

/**
 * Delete header logo from S3 and clear the key.
 */
export async function deleteHeaderLogoKey(): Promise<{ success: true }> {
  console.log(`[domain:settings] deleteHeaderLogoKey`)
  try {
    const org = await requireSettings()

    if (org.headerLogoKey) {
      try {
        await deleteObject(org.headerLogoKey)
      } catch (err) {
        console.warn(
          `[domain:settings] Failed to delete header logo S3 object ${org.headerLogoKey}:`,
          err
        )
      }
    }

    await db.update(settings).set({ headerLogoKey: null }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()

    return { success: true }
  } catch (error) {
    console.error(`[domain:settings] deleteHeaderLogoKey failed:`, error)
    wrapDbError('delete header logo key', error)
  }
}

// ============================================================================
// Header Display
// ============================================================================

const VALID_HEADER_MODES = ['logo_and_name', 'logo_only', 'custom_logo'] as const

export async function updateHeaderDisplayMode(mode: string): Promise<string> {
  console.log(`[domain:settings] updateHeaderDisplayMode: mode=${mode}`)
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
    console.error(`[domain:settings] updateHeaderDisplayMode failed:`, error)
    wrapDbError('update header display mode', error)
  }
}

export async function updateHeaderDisplayName(name: string | null): Promise<string | null> {
  console.log(`[domain:settings] updateHeaderDisplayName`)
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
    console.error(`[domain:settings] updateHeaderDisplayName failed:`, error)
    wrapDbError('update header display name', error)
  }
}

export async function updateWorkspaceName(name: string): Promise<string> {
  console.log(`[domain:settings] updateWorkspaceName`)
  try {
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
    console.error(`[domain:settings] updateWorkspaceName failed:`, error)
    wrapDbError('update workspace name', error)
  }
}
