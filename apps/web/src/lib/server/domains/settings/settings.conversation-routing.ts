/**
 * Shared conversation routing: which agent a new conversation is assigned to.
 *
 * Canonical storage is the settings.metadata bag (`conversationRouting`).
 * Read-time fallback from the released `widgetConfig.messenger.routing` so
 * existing installs keep their toggle until an admin saves the hub card.
 */
import { logger } from '@/lib/server/logger'
import { requireSettings, wrapDbError, writeMetadataKey } from './settings.helpers'

const log = logger.child({ component: 'settings-conversation-routing' })

const METADATA_KEY = 'conversationRouting'

export type ConversationRoutingConfig = {
  enabled: boolean
  strategy: 'auto_assign_active'
}

export const DEFAULT_CONVERSATION_ROUTING: ConversationRoutingConfig = {
  enabled: false,
  strategy: 'auto_assign_active',
}

export function resolveConversationRouting(
  metadataJson: string | null,
  widgetConfigJson: string | null
): ConversationRoutingConfig {
  if (metadataJson) {
    try {
      const meta = JSON.parse(metadataJson) as Record<string, unknown>
      if (METADATA_KEY in meta) {
        const raw = meta[METADATA_KEY]
        if (raw && typeof raw === 'object') {
          const enabled = (raw as { enabled?: unknown }).enabled === true
          return { enabled, strategy: 'auto_assign_active' }
        }
      }
    } catch {
      // Fall through to the legacy key / default.
    }
  }
  const legacy = readLegacyRouting(widgetConfigJson)
  if (legacy) return legacy
  return DEFAULT_CONVERSATION_ROUTING
}

function readLegacyRouting(widgetConfigJson: string | null): ConversationRoutingConfig | null {
  if (!widgetConfigJson) return null
  try {
    const wc = JSON.parse(widgetConfigJson) as {
      messenger?: { routing?: { enabled?: unknown; strategy?: unknown } }
    }
    const routing = wc.messenger?.routing
    if (!routing || typeof routing !== 'object') return null
    return {
      enabled: routing.enabled === true,
      strategy: 'auto_assign_active',
    }
  } catch {
    return null
  }
}

export async function getConversationRouting(): Promise<ConversationRoutingConfig> {
  try {
    const org = await requireSettings()
    return resolveConversationRouting(org.metadata, org.widgetConfig)
  } catch (error) {
    log.error({ err: error }, 'get conversation routing failed')
    wrapDbError('fetch conversation routing', error)
  }
}

export async function updateConversationRouting(
  input: ConversationRoutingConfig
): Promise<ConversationRoutingConfig> {
  log.info({ enabled: input.enabled }, 'update conversation routing')
  try {
    const next: ConversationRoutingConfig = {
      enabled: input.enabled === true,
      strategy: 'auto_assign_active',
    }
    await writeMetadataKey(METADATA_KEY, next)
    return next
  } catch (error) {
    log.error({ err: error }, 'update conversation routing failed')
    wrapDbError('update conversation routing', error)
  }
}
