/**
 * Query-options factory for the support inbox — the single source of truth for
 * its query keys + fetchers, shared by the route loader (SSR prefetch via
 * ensureQueryData) and the page components (useQuery). Both sides referencing
 * the same factory is what makes the loader's prefetch hydrate the component's
 * read instead of triggering a second client-side fetch.
 *
 * The keys are deliberately identical to the inline ones the inbox shipped with
 * (conversation-inbox.test.ts pins them) so SSE cache writes, invalidations, and the
 * per-scope conversation memory keep matching.
 */
import { queryOptions } from '@tanstack/react-query'
import type { ConversationId } from '@quackback/ids'
import { listConversationsFn, getConversationFn } from '@/lib/server/functions/conversation'
import { fetchConversationTagsWithCountsFn } from '@/lib/server/functions/conversation-tags'
import { fetchInboxSegmentsWithCountsFn } from '@/lib/server/functions/conversation-segments'
import {
  inboxNavKey,
  buildListParams,
  type InboxNavItem,
  type StatusFilter,
} from '@/lib/client/conversation/inbox-scope'
import type { ConversationPriority } from '@/lib/shared/conversation/types'

export const conversationInboxQueries = {
  /** The conversation list for a scope + status/priority/search refinement. */
  conversationList: (
    nav: InboxNavItem,
    status: StatusFilter,
    priority: ConversationPriority | 'all',
    search: string
  ) =>
    queryOptions({
      queryKey: ['admin', 'inbox', 'conversations', inboxNavKey(nav), status, priority, search],
      queryFn: () => listConversationsFn({ data: buildListParams(nav, status, priority, search) }),
    }),

  /** A single conversation's thread (conversation DTO + first page of messages). */
  thread: (conversationId: ConversationId) =>
    queryOptions({
      queryKey: ['admin', 'inbox', 'thread', conversationId],
      queryFn: () => getConversationFn({ data: { conversationId } }),
    }),

  /** Labels + per-tag open-conversation counts (drives the nav Tags group). */
  tagCounts: () =>
    queryOptions({
      queryKey: ['admin', 'inbox', 'conversation-tags', 'counts'],
      queryFn: () => fetchConversationTagsWithCountsFn(),
      staleTime: 60_000,
    }),

  /** Segments + per-segment open-conversation counts (drives the nav Segments group). */
  segmentCounts: () =>
    queryOptions({
      queryKey: ['admin', 'inbox', 'segments', 'counts'],
      queryFn: () => fetchInboxSegmentsWithCountsFn(),
      staleTime: 60_000,
    }),
}
