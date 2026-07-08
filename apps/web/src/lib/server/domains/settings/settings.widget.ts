import { randomBytes } from 'crypto'
import { db, eq, settings } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import type {
  WidgetConfig,
  PublicWidgetConfig,
  PublicLiveChatConfig,
  UpdateWidgetConfigInput,
  LiveChatConfig,
} from './settings.types'
import { DEFAULT_WIDGET_CONFIG, DEFAULT_LIVE_CHAT_CONFIG } from './settings.types'

const log = logger.child({ component: 'settings-widget' })

/** Drop agent-only fields (cannedReplies) from a chat config for public
 *  exposure. Allowlist projection: new fields are excluded unless added here. */
export function publicLiveChatConfig(chat: LiveChatConfig): PublicLiveChatConfig {
  return {
    enabled: chat.enabled,
    welcomeMessage: chat.welcomeMessage,
    offlineMessage: chat.offlineMessage,
    teamName: chat.teamName,
    officeHours: chat.officeHours,
    preChatEmail: chat.preChatEmail,
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
        // The chat tab is gated by the experimental `chat` flag (off by
        // default), so a public consumer never surfaces it until the workspace
        // opts in — no per-endpoint gating needed downstream.
        chat: (config.tabs?.chat ?? false) && (await isFeatureEnabled('supportInbox')),
        home: config.tabs?.home,
      },
      hmacRequired: config.identifyVerification ?? false,
      imageUploadsInWidget: config.imageUploadsInWidget ?? true,
      ticketing: { enabled: config.ticketing?.enabled ?? false },
      // Project only client-safe chat fields; cannedReplies is agent-only.
      chat: publicLiveChatConfig(config.chat ?? DEFAULT_LIVE_CHAT_CONFIG),
    }
  } catch (error) {
    log.error({ err: error }, 'get public widget config failed')
    wrapDbError('fetch public widget config', error)
  }
}

/**
 * Resolve the chat config, deep-merged over defaults so callers always see
 * welcome/offline copy even for tenants whose stored config predates chat.
 */
export async function getLiveChatConfig(): Promise<LiveChatConfig> {
  const widget = await getWidgetConfig()
  return { ...DEFAULT_LIVE_CHAT_CONFIG, ...(widget.chat ?? {}) }
}

/**
 * Whether chat is enabled for this workspace. Gated first by the
 * experimental `chat` feature flag (off by default); below it the per-widget
 * master + chat toggles still apply. This is the single choke point the
 * widget-facing chat paths (send, stream, visitor history) already consult, so
 * flipping the flag off fails them all closed.
 */
export async function isLiveChatEnabled(): Promise<boolean> {
  const { isFeatureEnabled } = await import('./settings.service')
  const [flagOn, widget] = await Promise.all([isFeatureEnabled('supportInbox'), getWidgetConfig()])
  return Boolean(flagOn && widget.enabled && widget.chat?.enabled)
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
