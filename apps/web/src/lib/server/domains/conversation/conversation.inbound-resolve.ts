/**
 * Shared three-step inbound conversation resolution:
 *   1. correlation key (channel-specific)
 *   2. sender's open conversation (optional)
 *   3. create (caller)
 *
 * Email keeps its Message-ID map as step 1 and does not use step 2, so its
 * behavior is unchanged. Future channels use channel_threads for step 1.
 */
import { and, db, desc, eq, conversations, channelThreads } from '@/lib/server/db'
import type { ChannelAccountId, ConversationId, PrincipalId } from '@quackback/ids'

export async function resolveInboundConversation(opts: {
  lookupCorrelation: () => Promise<ConversationId | null>
  lookupOpenBySender?: () => Promise<ConversationId | null>
}): Promise<ConversationId | null> {
  const byKey = await opts.lookupCorrelation()
  if (byKey) return byKey
  if (opts.lookupOpenBySender) return opts.lookupOpenBySender()
  return null
}

export async function lookupChannelThread(
  channelAccountId: ChannelAccountId,
  externalThreadKey: string
): Promise<ConversationId | null> {
  const key = externalThreadKey.trim()
  if (!key) return null
  const [row] = await db
    .select({ conversationId: channelThreads.conversationId })
    .from(channelThreads)
    .where(
      and(
        eq(channelThreads.channelAccountId, channelAccountId),
        eq(channelThreads.externalThreadKey, key)
      )
    )
    .limit(1)
  return row?.conversationId ?? null
}

export async function lookupChannelThreadByConversation(
  conversationId: ConversationId
): Promise<{ channelAccountId: ChannelAccountId; externalThreadKey: string } | null> {
  const [row] = await db
    .select({
      channelAccountId: channelThreads.channelAccountId,
      externalThreadKey: channelThreads.externalThreadKey,
    })
    .from(channelThreads)
    .where(eq(channelThreads.conversationId, conversationId))
    .limit(1)
  if (!row) return null
  return {
    channelAccountId: row.channelAccountId as ChannelAccountId,
    externalThreadKey: row.externalThreadKey,
  }
}

export async function rememberChannelThread(input: {
  channelAccountId: ChannelAccountId
  externalThreadKey: string
  conversationId: ConversationId
}): Promise<void> {
  const key = input.externalThreadKey.trim()
  if (!key) return
  await db
    .insert(channelThreads)
    .values({
      channelAccountId: input.channelAccountId,
      externalThreadKey: key,
      conversationId: input.conversationId,
    })
    .onConflictDoNothing()
}

export async function findOpenConversationBySender(
  visitorPrincipalId: PrincipalId
): Promise<ConversationId | null> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.visitorPrincipalId, visitorPrincipalId),
        eq(conversations.status, 'open')
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1)
  return row?.id ?? null
}
