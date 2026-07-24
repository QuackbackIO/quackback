import { randomBytes } from 'crypto'
import { db, and, eq, lte, or, isNull, sql, settings } from '@/lib/server/db'
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
import {
  DEFAULT_WIDGET_CONFIG,
  DEFAULT_MESSENGER_CONFIG,
  DEFAULT_HELP_CENTER_CONFIG,
  resolveFeatureFlags,
} from './settings.types'
import type { AssistantConfigAuditActor } from './settings.assistant'
import { recordAuditEventInTransaction } from '@/lib/server/audit/log'
import {
  assistantConfigSchema,
  DEFAULT_ASSISTANT_CONFIG,
  type AssistantIdentity,
} from '@/lib/shared/assistant/config'

const log = logger.child({ component: 'settings-widget' })
export const WIDGET_OBSERVATION_THROTTLE_MS = 15 * 60 * 1000

/**
 * Return a normalized external Origin hostname, or null for requests that must
 * not count as installation evidence. Origin is a browser-controlled header;
 * malformed, opaque, originless, same-host, and same-origin preview requests
 * are ignored.
 */
export function externalWidgetOriginHostname(request: Request): string | null {
  const originHeader = request.headers.get('origin')
  if (!originHeader || originHeader === 'null' || originHeader.includes(',')) return null
  if (request.headers.get('sec-fetch-site') === 'same-origin') return null

  try {
    const origin = new URL(originHeader)
    const endpoint = new URL(request.url)
    if (
      (origin.protocol !== 'http:' && origin.protocol !== 'https:') ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      return null
    const hostname = origin.hostname.toLowerCase().replace(/\.$/, '')
    if (!hostname || hostname.length > 253) return null
    if (hostname === endpoint.hostname.toLowerCase().replace(/\.$/, '')) return null
    return hostname
  } catch {
    return null
  }
}

/**
 * Record external widget installation evidence without touching the tenant
 * settings cache. The conditional update makes first/last-seen behavior and
 * the 15-minute throttle atomic under concurrent public requests.
 */
export async function observeExternalWidgetRequest(
  request: Request,
  now = new Date()
): Promise<boolean> {
  const hostname = externalWidgetOriginHostname(request)
  if (!hostname) return false
  const org = await db.query.settings.findFirst({ columns: { id: true } })
  if (!org) return false

  const staleBefore = new Date(now.getTime() - WIDGET_OBSERVATION_THROTTLE_MS)
  const updated = await db
    .update(settings)
    .set({
      widgetInstalledFirstSeenAt: sql`coalesce(${settings.widgetInstalledFirstSeenAt}, ${now})`,
      widgetInstalledLastSeenAt: now,
      widgetInstalledOriginHost: hostname,
    })
    .where(
      and(
        eq(settings.id, org.id),
        or(
          isNull(settings.widgetInstalledFirstSeenAt),
          isNull(settings.widgetInstalledLastSeenAt),
          lte(settings.widgetInstalledLastSeenAt, staleBefore)
        )
      )
    )
    .returning({ id: settings.id })
  return updated.length > 0
}

/**
 * Client-safe projection of the Home config: the stored S3 key is swapped for
 * its resolved public URL so clients never see (or depend on) raw keys.
 */
export function publicHomeConfig(home: WidgetHomeConfig | undefined): WidgetHomeConfig | undefined {
  if (!home) return undefined
  const { heroImageKey, ...rest } = home
  return { ...rest, heroImageUrl: getPublicUrlOrNull(heroImageKey) }
}

/** Drop agent-only fields (routing) from a messenger config for public
 *  exposure. Allowlist projection: new fields are excluded unless added here.
 *  Office hours are NOT projected here — the widget reads availability from the
 *  presence snapshot (getConversationPresenceFn), which resolves the one canonical
 *  schedule via `@/lib/shared/office-hours`. */
export function publicMessengerConfig(
  messenger: MessengerConfig,
  identity: AssistantIdentity = DEFAULT_ASSISTANT_CONFIG.identity
): PublicMessengerConfig {
  return {
    enabled: messenger.enabled,
    welcomeMessage: messenger.welcomeMessage,
    offlineMessage: messenger.offlineMessage,
    teamName: messenger.teamName,
    assistant: messenger.assistant
      ? {
          enabled: messenger.assistant.enabled,
          respond: messenger.assistant.respond,
          name: identity.name,
          avatarUrl: identity.avatarUrl,
        }
      : undefined,
  }
}
import {
  requireSettings,
  requireSettingsCached,
  wrapDbError,
  parseJsonConfig,
  deepMerge,
  invalidateSettingsCache,
} from './settings.helpers'

export async function getWidgetConfig(): Promise<WidgetConfig> {
  try {
    // Read-only + on public hot paths (sdk.js, identify): cached row.
    const org = await requireSettingsCached()
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
    // The translations map replaces wholesale — deepMerge would union locale
    // keys, so a removed locale or a cleared field could never disappear.
    if (input.translations !== undefined) updated.translations = input.translations
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

/** Update only the web-widget deployment flags; behavior config is never touched. */
export async function updateWidgetAssistantDeployment(
  input: { enabled: boolean; respond: boolean },
  actor: AssistantConfigAuditActor
): Promise<{ enabled: boolean; respond: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: settings.id, widgetConfig: settings.widgetConfig })
      .from(settings)
      .limit(1)
      .for('update')
    if (!row) throw new Error('Settings not found')

    const config = parseJsonConfig(row.widgetConfig, DEFAULT_WIDGET_CONFIG)
    const current = config.messenger?.assistant ?? {}
    const messenger = {
      ...(config.messenger ?? DEFAULT_MESSENGER_CONFIG),
      assistant: { enabled: input.enabled, respond: input.respond },
    }
    await tx
      .update(settings)
      .set({ widgetConfig: JSON.stringify({ ...config, messenger }) })
      .where(eq(settings.id, row.id))

    const { headers, ...auditActor } = actor
    await recordAuditEventInTransaction(tx, {
      event: 'assistant.deployment.changed',
      actor: auditActor,
      headers,
      target: { type: 'settings', id: row.id },
      metadata: {
        changedPaths: ['widget.assistant.enabled', 'widget.assistant.respond'],
        transitions: [
          { path: 'widget.assistant.enabled', from: current.enabled ?? true, to: input.enabled },
          { path: 'widget.assistant.respond', from: current.respond ?? false, to: input.respond },
        ],
      },
    })
    return input
  })
  await invalidateSettingsCache()
  return result
}

export async function getPublicWidgetConfig(): Promise<PublicWidgetConfig> {
  try {
    // Read-only + on public hot paths (config.json, widget SSR): cached row.
    const org = await requireSettingsCached()
    const config = parseJsonConfig(org.widgetConfig, DEFAULT_WIDGET_CONFIG)
    const assistantConfig = assistantConfigSchema.safeParse(org.assistantConfig)
    const identity = assistantConfig.success
      ? assistantConfig.data.identity
      : DEFAULT_ASSISTANT_CONFIG.identity
    const flags = resolveFeatureFlags(org.featureFlags)
    const helpCenter = parseJsonConfig(org.helpCenterConfig, DEFAULT_HELP_CENTER_CONFIG)
    const tabs = {
      feedback: (config.tabs?.feedback ?? true) && flags.feedback,
      changelog: (config.tabs?.changelog ?? false) && flags.changelog,
      help: (config.tabs?.help ?? false) && flags.helpCenter && helpCenter.enabled,
      messenger:
        (config.tabs?.messenger ?? false) &&
        flags.supportInbox &&
        (config.messenger?.enabled ?? false),
      // Converged Messages: ticket pairs surface through the messenger tab,
      // gated by the supportTickets flag alone (there is no Tickets tab).
      tickets: flags.supportTickets,
      home: config.tabs?.home,
    }
    return {
      enabled:
        config.enabled &&
        [tabs.feedback, tabs.changelog, tabs.help, tabs.messenger, tabs.tickets].some(Boolean),
      defaultBoard: config.defaultBoard,
      position: config.position,
      launcherGreeting: config.launcherGreeting,
      tabs,
      // Identify is verified-only (backend-signed ssoToken; GH issue #300).
      hmacRequired: true,
      // Home customisation is client-safe (greeting, hero style, quick links);
      // the stored hero-image key is resolved to a public URL.
      home: publicHomeConfig(config.home),
      // Project only client-safe messenger fields; routing is agent-only.
      messenger: publicMessengerConfig(config.messenger ?? DEFAULT_MESSENGER_CONFIG, identity),
      // Per-locale copy overrides — client-safe (customer-facing strings the
      // widget resolves against its own locale for the Home surface).
      translations: config.translations,
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
