/**
 * Query keys for the portal Support tab. Shared between the header (unread
 * badge) and the Support pages so a read in one invalidates/refreshes both.
 */
export const PORTAL_MY_CONVERSATIONS_QUERY_KEY = ['portal', 'my-conversations'] as const

export const PORTAL_CONVERSATION_PRESENCE_QUERY_KEY = ['portal', 'conversation-presence'] as const
