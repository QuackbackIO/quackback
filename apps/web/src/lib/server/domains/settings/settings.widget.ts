import { randomBytes } from 'crypto'
import { db, eq, settings } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { deleteObject, getPublicUrlOrNull } from '@/lib/server/storage/s3'
import type {
  WidgetConfig,
  WidgetHomeConfig,
  PublicWidgetConfig,
  PublicMessengerConfig,
  UpdateWidgetConfigInput,
  MessengerConfig,
} from './settings.types'
import { DEFAULT_WIDGET_CONFIG, DEFAULT_MESSENGER_CONFIG } from './settings.types'

const log = logger.child({ component: 'settings-widget' })

/**
 * Client-safe projection of the Home config: the stored S3 key is swapped for
 * its resolved public URL so clients never see (or depend on) raw keys.
 */
export function publicHomeConfig(home: WidgetHomeConfig | undefined): WidgetHomeConfig | undefined {
  if (!home) return undefined
  const { heroImageKey, ...rest } = home
  return { ...rest, heroImageUrl: getPublicUrlOrNull(heroImageKey) }
}

/** Drop agent-only fields (cannedReplies) from a messenger config for public
 *  exposure. Allowlist projection: new fields are excluded unless added here. */
export function publicMessengerConfig(messenger: MessengerConfig): PublicMessengerConfig {
  return {
    enabled: messenger.enabled,
    welcomeMessage: messenger.welcomeMessage,
    offlineMessage: messenger.offlineMessage,
    teamName: messenger.teamName,
    officeHours: messenger.officeHours,
    assistant: messenger.assistant,
  }
}
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
    log.error({ err: error }, 'get widget config failed')
    wrapDbError('fetch widget config', error)
  }
}

export async function updateWidgetConfig(input: UpdateWidgetConfigInput): Promise<WidgetConfig> {
  log.info('update widget config')
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
    log.error({ err: error }, 'update widget config failed')
    wrapDbError('update widget config', error)
  }
}

export async function getPublicWidgetConfig(): Promise<PublicWidgetConfig> {
  try {
    const org = await requireSettings()
    const config = parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)
    const { isFeatureEnabled } = await import('./settings.service')
    return {
      enabled: config.enabled,
      defaultBoard: config.defaultBoard,
      position: config.position,
      tabs: {
        feedback: config.tabs?.feedback,
        changelog: config.tabs?.changelog,
        help: config.tabs?.help,
        // The Messages tab is gated by the experimental `supportInbox` flag (off
        // by default), so a public consumer never surfaces it until the
        // workspace opts in — no per-endpoint gating needed downstream.
        messenger: (config.tabs?.messenger ?? false) && (await isFeatureEnabled('supportInbox')),
        home: config.tabs?.home,
      },
      // Identify is verified-only (backend-signed ssoToken; GH issue #300).
      hmacRequired: true,
      // Home customisation is client-safe (greeting, hero style, quick links);
      // the stored hero-image key is resolved to a public URL.
      home: publicHomeConfig(config.home),
      // Project only client-safe messenger fields; cannedReplies is agent-only.
      messenger: publicMessengerConfig(config.messenger ?? DEFAULT_MESSENGER_CONFIG),
    }
  } catch (error) {
    log.error({ err: error }, 'get public widget config failed')
    wrapDbError('fetch public widget config', error)
  }
}

/**
 * Resolve the messenger config, deep-merged over defaults so callers always see
 * welcome/offline copy even for tenants whose stored config predates messenger.
 */
export async function getMessengerConfig(): Promise<MessengerConfig> {
  const widget = await getWidgetConfig()
  return { ...DEFAULT_MESSENGER_CONFIG, ...(widget.messenger ?? {}) }
}

/**
 * Whether messenger is enabled for this workspace. Gated first by the
 * experimental `supportInbox` feature flag (off by default); below it the
 * per-widget master + messenger toggles still apply. This is the single choke point the
 * widget-facing messenger paths (send, stream, visitor history) already consult, so
 * flipping the flag off fails them all closed.
 */
export async function isMessengerEnabled(): Promise<boolean> {
  const { isFeatureEnabled } = await import('./settings.service')
  const [flagOn, widget] = await Promise.all([isFeatureEnabled('supportInbox'), getWidgetConfig()])
  return Boolean(flagOn && widget.enabled && widget.messenger?.enabled)
}

/**
 * Save the Home hero image's S3 key, deleting the previous object if one
 * exists. The single writer for `home.heroImageKey` — the generic config
 * update deliberately cannot touch it, so the object lifecycle stays here.
 */
export async function saveWidgetHeroImageKey(key: string): Promise<void> {
  log.info('save widget hero image key')
  try {
    const config = await getWidgetConfig()
    const oldKey = config.home?.heroImageKey
    if (oldKey && oldKey !== key) {
      try {
        await deleteObject(oldKey)
      } catch (err) {
        log.warn({ err, hero_key: oldKey }, 'failed to delete old widget hero s3 object')
      }
    }
    await updateWidgetConfig({ home: { heroImageKey: key, headerStyle: 'image' } })
  } catch (error) {
    log.error({ err: error }, 'save widget hero image key failed')
    wrapDbError('save widget hero image key', error)
  }
}

/** Delete the Home hero image (S3 object + stored key); falls back to plain. */
export async function deleteWidgetHeroImage(): Promise<void> {
  log.info('delete widget hero image')
  try {
    const config = await getWidgetConfig()
    const oldKey = config.home?.heroImageKey
    if (oldKey) {
      try {
        await deleteObject(oldKey)
      } catch (err) {
        log.warn({ err, hero_key: oldKey }, 'failed to delete widget hero s3 object')
      }
    }
    await updateWidgetConfig({ home: { heroImageKey: '', headerStyle: 'plain' } })
  } catch (error) {
    log.error({ err: error }, 'delete widget hero image failed')
    wrapDbError('delete widget hero image', error)
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
    log.error({ err: error }, 'get widget secret failed')
    wrapDbError('fetch widget secret', error)
  }
}

/** Regenerate the widget secret. Returns the new secret once. */
export async function regenerateWidgetSecret(): Promise<string> {
  log.info('regenerate widget secret')
  try {
    const org = await requireSettings()
    const secret = generateWidgetSecret()
    await db.update(settings).set({ widgetSecret: secret }).where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return secret
  } catch (error) {
    log.error({ err: error }, 'regenerate widget secret failed')
    wrapDbError('regenerate widget secret', error)
  }
}
