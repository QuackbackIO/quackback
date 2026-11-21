/**
 * When a chat channel (Slack, Discord) holds back a customer's support message.
 *
 * The channel exists to get a teammate to a customer, so it stays quiet when
 * someone is already there:
 *
 * - `opening_message`: the first message of a new conversation, when the same
 *   channel also gets the new conversation notice, which already quotes it.
 *   One request then posts once rather than twice.
 * - `assignee_online`: a later reply, while the conversation's assigned
 *   teammate has the app open and is not set to Away, so they see it live.
 *
 * Anything uncertain posts: an unassigned conversation, an unreadable
 * presence store, a channel that only gets customer messages. A spare post is
 * cheaper than a customer reply nobody sees.
 */
import { and, db, eq, conversations, integrations, integrationEventMappings } from '@/lib/server/db'
import type { EventData } from '@/lib/server/events/types'
import type { ConversationId, IntegrationId, PrincipalId } from '@quackback/ids'

export type SupportAlertHold = 'opening_message' | 'assignee_online'

export async function supportAlertHold(
  event: EventData,
  route: { integrationId: string; channelId: string }
): Promise<SupportAlertHold | null> {
  if (event.type !== 'message.created' || event.data.message.senderType !== 'visitor') return null

  if (event.data.isFirstMessage) {
    return (await channelGetsNewConversations(route)) ? 'opening_message' : null
  }

  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, event.data.conversation.id as ConversationId),
    columns: { assignedAgentPrincipalId: true },
  })
  const assignee = conversation?.assignedAgentPrincipalId
  if (!assignee) return null
  const { readAvailableAgentIds } = await import('@/lib/server/realtime/presence')
  const available = await readAvailableAgentIds()
  return available?.includes(assignee as PrincipalId) ? 'assignee_online' : null
}

async function channelGetsNewConversations(route: {
  integrationId: string
  channelId: string
}): Promise<boolean> {
  const integration = await db.query.integrations.findFirst({
    where: eq(integrations.id, route.integrationId as IntegrationId),
    columns: { config: true },
  })
  const legacyChannelId = (integration?.config as { channelId?: unknown } | null)?.channelId
  const mappings = await db.query.integrationEventMappings.findMany({
    where: and(
      eq(integrationEventMappings.integrationId, route.integrationId as IntegrationId),
      eq(integrationEventMappings.eventType, 'conversation.created'),
      eq(integrationEventMappings.enabled, true)
    ),
    columns: { actionConfig: true },
  })
  return mappings.some(
    (m) =>
      ((m.actionConfig as { channelId?: unknown } | null)?.channelId || legacyChannelId) ===
      route.channelId
  )
}
