import { randomBytes } from 'crypto'
import { db, eq, settings } from '@/lib/server/db'
import type { WidgetConfig, PublicWidgetConfig, UpdateWidgetConfigInput } from './settings.types'
import { DEFAULT_WIDGET_CONFIG } from './settings.types'
import {
  requireSettings,
  wrapDbError,
  parseJsonConfig,
  deepMerge,
  invalidateSettingsCache,
} from './settings.helpers'

export async function getWidgetConfig(): Promise<WidgetConfig> {
  try {
    const org = await requireSettings()
    return parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)
  } catch (error) {
    console.error(`[domain:settings] getWidgetConfig failed:`, error)
    wrapDbError('fetch widget config', error)
  }
}

export async function updateWidgetConfig(input: UpdateWidgetConfigInput): Promise<WidgetConfig> {
  console.log(`[domain:settings] updateWidgetConfig`)
  try {
    const org = await requireSettings()
    const existing = parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)
    const updated = deepMerge(existing, input as Partial<WidgetConfig>)
    await db
      .update(settings)
      .set({ widgetConfig: JSON.stringify(updated) })
      .where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return updated
  } catch (error) {
    console.error(`[domain:settings] updateWidgetConfig failed:`, error)
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
      tabs: config.tabs,
      hmacRequired: config.identifyVerification ?? false,
    }
  } catch (error) {
    console.error(`[domain:settings] getPublicWidgetConfig failed:`, error)
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
    console.error(`[domain:settings] getWidgetSecret failed:`, error)
    wrapDbError('fetch widget secret', error)
  }
}

/** Regenerate the widget secret. Returns the new secret once. */
export async function regenerateWidgetSecret(): Promise<string> {
  console.log(`[domain:settings] regenerateWidgetSecret`)
  try {
    const org = await requireSettings()
    const secret = generateWidgetSecret()
    await db.update(settings).set({ widgetSecret: secret }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return secret
  } catch (error) {
    console.error(`[domain:settings] regenerateWidgetSecret failed:`, error)
    wrapDbError('regenerate widget secret', error)
  }
}
