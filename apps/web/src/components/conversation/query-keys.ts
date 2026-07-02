/**
 * The conversation module's key surface. The factory itself lives in
 * lib/client/queries (lib must not import from components, and the inbox
 * query-options factory consumes it too); this re-export keeps the feature
 * module self-contained for its component consumers.
 */
export { conversationKeys } from '@/lib/client/queries/conversation-keys'
