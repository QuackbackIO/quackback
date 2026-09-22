import type { IntegrationDefinition } from '@/lib/server/integrations/types'
import { InternalError } from '@/lib/shared/errors'

export type SyncHistoryReason =
  'ok' | 'no_installation' | 'not_active' | 'no_ledger' | 'no_destination'

export function routedChannelIds(
  config: Record<string, unknown>,
  mappings: { actionConfig: unknown }[]
): { channelId: string }[] {
  const ids = new Set<string>()
  for (const mapping of mappings) {
    const actionConfig = (mapping.actionConfig as Record<string, unknown> | null) ?? {}
    const channelId = actionConfig.channelId ?? config.channelId
    if (typeof channelId === 'string' && channelId.trim()) ids.add(channelId)
  }
  return [...ids].map((channelId) => ({ channelId }))
}

export function writesLedger(definition: IntegrationDefinition | undefined): boolean {
  if (!definition) return false
  return Boolean(
    definition.hook ||
    definition.inbound ||
    definition.userSync ||
    definition.appHooks ||
    definition.linkedItems
  )
}

/** Segment's connection is the destination. A tracker that also syncs users is not. */
export function connectionIsDestination(definition: IntegrationDefinition | undefined): boolean {
  if (!definition?.userSync) return false
  return !definition.hook && !definition.inbound && !definition.appHooks && !definition.linkedItems
}

function selectedChannel(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Jira still delivers a bare project id. A colon with an empty side is incomplete. */
function jiraDestinationSelected(channelId: string): boolean {
  const sep = channelId.indexOf(':')
  if (sep === -1) return true
  return sep > 0 && sep < channelId.length - 1
}

/** Azure needs project:workItemType. The split is the first colon. */
function azureDestinationSelected(channelId: string): boolean {
  const sep = channelId.indexOf(':')
  return sep > 0 && sep < channelId.length - 1
}

export function syncHistoryAvailable(input: {
  provider: string
  status: string | null
  config: Record<string, unknown>
  notificationChannels: { channelId: string }[]
  writesLedger: boolean
  connectionIsDestination: boolean
  slackAssistantEnabled: boolean
}): { available: boolean; reason: SyncHistoryReason } {
  if (!input.status) return { available: false, reason: 'no_installation' }
  if (input.status !== 'active') return { available: false, reason: 'not_active' }
  if (!input.writesLedger) return { available: false, reason: 'no_ledger' }
  if (input.connectionIsDestination) return { available: true, reason: 'ok' }
  if (input.provider === 'slack' && input.slackAssistantEnabled)
    return { available: true, reason: 'ok' }

  const channelId = selectedChannel(input.config.channelId)
  const routed = input.notificationChannels.some((channel) => selectedChannel(channel.channelId))
  if (input.provider === 'slack' || input.provider === 'discord') {
    return routed || channelId
      ? { available: true, reason: 'ok' }
      : { available: false, reason: 'no_destination' }
  }
  if (!channelId) return { available: false, reason: 'no_destination' }
  if (input.provider === 'jira' && !jiraDestinationSelected(channelId))
    return { available: false, reason: 'no_destination' }
  if (input.provider === 'azure_devops' && !azureDestinationSelected(channelId))
    return { available: false, reason: 'no_destination' }
  return { available: true, reason: 'ok' }
}

export async function readSlackAssistantEnabled(provider: string): Promise<boolean> {
  if (provider !== 'slack') return false
  try {
    const { getAssistantSettings } =
      await import('@/lib/server/domains/settings/settings.assistant')
    const settings = await getAssistantSettings()
    return settings.config.agents.workspace.slack.enabled === true
  } catch (error) {
    if (error instanceof InternalError && error.code === 'ASSISTANT_CONFIG_INVALID') return false
    throw error
  }
}
