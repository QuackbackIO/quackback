/**
 * Persist outbound channel-delivery status on an agent message and fan the
 * change to the inbox stream so ticks move pending → sent/failed live.
 */
import { db, eq, conversationMessages, type ConversationMessageMetadata } from '@/lib/server/db'
import type { Channel, ChannelDelivery } from '@/lib/shared/db-types'
import type { ConversationMessageId } from '@quackback/ids'
import { getChannelDescriptor } from '@/lib/shared/channels'
import { broadcastInboxMessageUpdated } from './message.actions'

const MAX_ERROR_LENGTH = 160

export function pendingChannelDelivery(channel: Channel): ChannelDelivery {
  return { status: 'pending', channel, at: new Date().toISOString() }
}

export function isThreadAddressedChannel(channel: Channel): boolean {
  return getChannelDescriptor(channel)?.addressing === 'thread'
}

export async function persistChannelDelivery(
  messageId: ConversationMessageId,
  patch: {
    status: ChannelDelivery['status']
    channel: Channel
    externalId?: string
    error?: string
  }
): Promise<void> {
  const [row] = await db
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.id, messageId))
    .limit(1)
  if (!row) return

  const previous = row.metadata?.channelDelivery
  const error =
    patch.status === 'failed'
      ? (patch.error ?? previous?.error)?.slice(0, MAX_ERROR_LENGTH)
      : undefined
  const channelDelivery: ChannelDelivery = {
    status: patch.status,
    channel: patch.channel,
    at: new Date().toISOString(),
    ...(patch.externalId
      ? { externalId: patch.externalId }
      : previous?.externalId
        ? { externalId: previous.externalId }
        : {}),
    ...(error ? { error } : {}),
  }
  const metadata: ConversationMessageMetadata = {
    ...(row.metadata ?? {}),
    channelDelivery,
    ...(patch.channel === 'github' && patch.externalId
      ? { source: 'github', githubCommentId: patch.externalId }
      : {}),
  }
  const [updated] = await db
    .update(conversationMessages)
    .set({ metadata })
    .where(eq(conversationMessages.id, messageId))
    .returning()
  if (updated) await broadcastInboxMessageUpdated(updated)
}
