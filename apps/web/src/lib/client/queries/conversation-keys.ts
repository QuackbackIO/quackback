/**
 * Query-key factory for conversation threads and lists across every surface:
 * the admin inbox, the portal Support tab, and the widget messenger. One
 * factory keeps SSE cache writes, invalidations, and SSR-prefetch hydration
 * pointing at the same keys (conversation-keys.test.ts pins them).
 *
 * Lives in lib (not the components/conversation module) so query factories
 * under lib/client/queries can consume it too — lib must not import from
 * components. The feature module re-exports it from query-keys.ts.
 */
import type { ConversationId, PrincipalId } from '@quackback/ids'

export const conversationKeys = {
  /** Prefix of every admin conversation-list query (invalidations target it). */
  agentConversations: () => ['admin', 'inbox', 'conversations'] as const,

  /** The admin conversation list for one scope + status/priority/search refinement. */
  agentConversationList: (scopeKey: string, status: string, priority: string, search: string) =>
    [...conversationKeys.agentConversations(), scopeKey, status, priority, search] as const,

  /** An open admin thread (conversation DTO + loaded messages). */
  agentThread: (conversationId: ConversationId) =>
    ['admin', 'inbox', 'thread', conversationId] as const,

  /** Labels + per-tag open-conversation counts (nav Tags group). */
  agentTagCounts: () => ['admin', 'inbox', 'conversation-tags', 'counts'] as const,

  /** Segments + per-segment open-conversation counts (nav Segments group). */
  agentSegmentCounts: () => ['admin', 'inbox', 'segments', 'counts'] as const,

  /** Shared saved views + the caller's pin state (nav Views group). */
  agentViews: () => ['admin', 'inbox', 'views'] as const,

  /** The detail panel's "Previous conversations" cache (prefix). */
  agentUserConversations: () => ['admin', 'inbox', 'user-conversations'] as const,

  /** The detail panel's "Previous conversations" query for one contact. */
  agentUserConversationsFor: (principalId: PrincipalId | undefined) =>
    [...conversationKeys.agentUserConversations(), principalId] as const,

  /** The detail panel's contact card (portal user detail) for one contact. */
  agentContactDetail: (principalId: PrincipalId | undefined) =>
    ['admin', 'inbox', 'visitor', principalId] as const,

  /** The detail panel's Quinn AI activity summary for one conversation. */
  agentAssistantActivity: (conversationId: ConversationId | undefined) =>
    ['admin', 'inbox', 'assistant-activity', conversationId] as const,

  /** The per-agent "Saved for later" (flagged messages) feed. */
  agentFlagged: () => ['admin', 'inbox', 'flagged'] as const,

  /** A visitor-side thread (portal Support tab + widget messenger). Keyed by
   *  conversation id; a not-yet-created thread has no cache entry. */
  visitorThread: (conversationId: ConversationId | null) =>
    ['conversation', 'visitor-thread', conversationId ?? 'none'] as const,

  /** The widget Messages tab list, re-keyed when identify swaps the actor. */
  widgetConversationList: (sessionVersion: number | string) =>
    ['widget', 'my-conversations', sessionVersion] as const,

  /** The portal Support tab list. */
  portalConversationList: () => ['portal', 'my-conversations'] as const,
}
