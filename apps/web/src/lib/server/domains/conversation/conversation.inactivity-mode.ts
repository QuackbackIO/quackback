import { db, eq, conversations } from '@/lib/server/db'
import { getConversationInactivitySettings } from '@/lib/server/domains/settings/settings.conversation-inactivity'
import type { ConversationId } from '@quackback/ids'

export async function customInactivityAllowed(conversationId: ConversationId): Promise<boolean> {
  const [row] = await db
    .select({ channel: conversations.channel, status: conversations.status })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!row || row.status !== 'open' || (row.channel !== 'messenger' && row.channel !== 'email'))
    return false
  const config = await getConversationInactivitySettings()
  return config.channels?.[row.channel] === 'custom'
}
