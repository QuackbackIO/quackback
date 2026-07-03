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
import type { ConversationId, CompanyId } from '@quackback/ids'
import {
  listConversationsFn,
  getConversationFn,
  fetchAssistantInboxCountsFn,
} from '@/lib/server/functions/conversation'
import { fetchConversationTagsWithCountsFn } from '@/lib/server/functions/conversation-tags'
import { fetchInboxSegmentsWithCountsFn } from '@/lib/server/functions/conversation-segments'
import { listConversationViewsFn } from '@/lib/server/functions/conversation-views'
import {
  inboxNavKey,
  buildListParams,
  type InboxNavItem,
  type StatusFilter,
  type AiBucket,
} from '@/lib/client/conversation/inbox-scope'
import { conversationKeys } from '@/lib/client/queries/conversation-keys'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import type { ConversationSort, ConversationViewListParams } from '@/lib/shared/conversation/views'

export const conversationInboxQueries = {
  /** The conversation list for a scope + status/priority/search refinement,
   *  optionally narrowed to one company. The base key stays byte-identical to
   *  the unfiltered inline key (so the loader's SSR prefetch still hydrates);
   *  a company appends to it, staying under the agentConversations() prefix so
   *  SSE invalidations keep matching. */
  conversationList: (
    nav: InboxNavItem,
    status: StatusFilter,
    priority: ConversationPriority | 'all',
    search: string,
    companyId?: CompanyId,
    // The active sort (default 'recent') and, for a custom view, its
    // pre-translated rule set. Both leave the base key byte-identical when
    // absent/default, so the loader's SSR prefetch keeps hydrating existing
    // scopes and the key-parity test still passes.
    sort?: ConversationSort,
    customParams?: ConversationViewListParams,
    // Quinn-view sub-filter (Resolved / Escalated / Pending); only set on the
    // 'quinn' scope, so it leaves every other scope's key byte-identical.
    aiBucket?: AiBucket
  ) => {
    const baseKey = conversationKeys.agentConversationList(
      inboxNavKey(nav),
      status,
      priority,
      search
    )
    // Append the non-default sort then the company (fixed order) — both stay
    // under the agentConversations() prefix SSE invalidations target.
    const key = [...baseKey]
    if (sort && sort !== 'recent') key.push(`sort:${sort}`)
    if (companyId) key.push(companyId)
    if (aiBucket) key.push(`ai:${aiBucket}`)
    return queryOptions({
      queryKey: key,
      queryFn: () =>
        listConversationsFn({
          data: buildListParams(
            nav,
            status,
            priority,
            search,
            companyId,
            sort,
            customParams,
            aiBucket
          ),
        }),
    })
  },

  /** Shared saved views with the caller's pin state (drives the nav Views group). */
  views: () =>
    queryOptions({
      queryKey: conversationKeys.agentViews(),
      queryFn: () => listConversationViewsFn(),
      staleTime: 60_000,
    }),

  /** A single conversation's thread (conversation DTO + first page of messages). */
  thread: (conversationId: ConversationId) =>
    queryOptions({
      queryKey: conversationKeys.agentThread(conversationId),
      queryFn: () => getConversationFn({ data: { conversationId } }),
    }),

  /** Labels + per-tag open-conversation counts (drives the nav Tags group). */
  tagCounts: () =>
    queryOptions({
      queryKey: conversationKeys.agentTagCounts(),
      queryFn: () => fetchConversationTagsWithCountsFn(),
      staleTime: 60_000,
    }),

  /** Conversation counts per Quinn-inbox bucket (drives the Quinn sub-filter badges). */
  assistantCounts: () =>
    queryOptions({
      queryKey: ['admin', 'inbox', 'assistant-counts'] as const,
      queryFn: () => fetchAssistantInboxCountsFn(),
      staleTime: 30_000,
    }),

  /** Segments + per-segment open-conversation counts (drives the nav Segments group). */
  segmentCounts: () =>
    queryOptions({
      queryKey: conversationKeys.agentSegmentCounts(),
      queryFn: () => fetchInboxSegmentsWithCountsFn(),
      staleTime: 60_000,
    }),
}
