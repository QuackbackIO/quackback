/**
 * The shapes of the cached inbox list pages, shared by the modules that patch
 * them in place (inbox-read.ts, inbox-removal.ts) and the inbox route.
 */
import type { ConversationDTO } from '@/lib/shared/conversation/types'
import type { InboxItemDTO } from '@/lib/shared/inbox/items'

/** A unified item-list page (`inboxKeys.items()`). */
export type ItemListPage = { items: InboxItemDTO[] }

/** A legacy conversation-list page (`conversationKeys.agentConversations()`). */
export type ConversationListPage = { conversations: ConversationDTO[] }

/** The stable string id of any unified inbox row. */
export function itemRefId(item: InboxItemDTO): string {
  return item.kind === 'conversation' ? item.conversation.id : item.ticket.id
}
