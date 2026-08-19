import { conversationKeys } from './conversation-keys'

/**
 * Query keys for the portal Support tab. Shared between the header (unread
 * badge) and the Support pages so a read in one invalidates/refreshes both.
 * Derived from the conversation key factory so the key has one owner.
 */
export const PORTAL_MY_CONVERSATIONS_QUERY_KEY = conversationKeys.portalConversationList()

export const PORTAL_CONVERSATION_PRESENCE_QUERY_KEY = ['portal', 'conversation-presence'] as const
