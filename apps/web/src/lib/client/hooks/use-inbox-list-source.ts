/**
 * The inbox route's list-source seam (UNIFIED-INBOX-SPEC.md §3.1): decides
 * whether the active nav scope reads the merged conversation+ticket endpoint
 * or the legacy conversation-only one, runs whichever query is live, and
 * normalizes the result into one `InboxItemDTO[]` — so the predicate
 * (`usesUnifiedInboxList`) and both param builders live in one place instead
 * of being re-derived at each of the route's loader/body/prefetch call sites.
 * The loader keeps its own `usesUnifiedInboxList` call (server context, no
 * hooks available there), but reads the exact same predicate this hook does.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CompanyId } from '@quackback/ids'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import {
  viewFiltersToListParams,
  type ConversationSort,
  type ConversationViewFilters,
} from '@/lib/shared/conversation/views'
import {
  buildInboxListParams,
  facetToStatusFilter,
  usesUnifiedInboxList,
  type InboxNavItem,
} from '@/lib/client/conversation/inbox-scope'
import { conversationInboxQueries } from '@/lib/client/queries/conversation-inbox'
import { inboxQueries } from '@/lib/client/queries/inbox'
import type { InboxItemDTO, InboxTriageFacet } from '@/lib/shared/inbox/items'

export interface UseInboxListSourceParams {
  nav: InboxNavItem
  facet: InboxTriageFacet
  priorityFilter: ConversationPriority | 'all'
  search: string
  companyId?: CompanyId
  sort: ConversationSort
  /** The active custom view's saved rule set, once loaded (undefined while a
   *  `nav.kind === 'custom'` view's rules haven't arrived yet from the views
   *  list — the legacy query stays disabled until then, mirroring the
   *  pre-extraction `!!activeView` guard). */
  activeViewFilters?: ConversationViewFilters
  /** Quinn-view sub-filter (Resolved / Escalated / Pending) — legacy path only. */
  aiBucket?: 'resolved' | 'escalated' | 'pending'
  /** The "Saved for later" scope shows flagged MESSAGES, not a list — both
   *  queries stay idle there (the route renders `SavedMessagesColumn` instead). */
  isSaved: boolean
}

export interface UseInboxListSourceResult {
  items: InboxItemDTO[]
  isLoading: boolean
}

/**
 * Runs whichever of the unified/legacy list queries the active scope needs
 * (both are always CALLED — rules of hooks — but only one is ever `enabled`)
 * and normalizes the result to `InboxItemDTO[]`.
 */
export function useInboxListSource({
  nav,
  facet,
  priorityFilter,
  search,
  companyId,
  sort,
  activeViewFilters,
  aiBucket,
  isSaved,
}: UseInboxListSourceParams): UseInboxListSourceResult {
  const useUnified = usesUnifiedInboxList(nav, activeViewFilters)
  // A custom view's legacy-path rules are pre-translated to the conversation
  // list's own param shape; the unified path re-translates the raw filters
  // itself inside `buildInboxListParams`.
  const customParams = useMemo(
    () => (activeViewFilters ? viewFiltersToListParams(activeViewFilters) : undefined),
    [activeViewFilters]
  )

  const { data: unifiedData, isLoading: unifiedLoading } = useQuery({
    ...inboxQueries.itemList(
      buildInboxListParams(nav, facet, priorityFilter, search, companyId, sort, activeViewFilters)
    ),
    refetchInterval: 30_000, // polling fallback until ticket SSE lands (M3)
    enabled: useUnified && !isSaved,
  })
  const { data: legacyData, isLoading: legacyLoading } = useQuery({
    ...conversationInboxQueries.conversationList(
      nav,
      facetToStatusFilter(facet),
      priorityFilter,
      search,
      companyId,
      sort,
      customParams,
      aiBucket
    ),
    refetchInterval: 30_000, // polling fallback if the stream drops
    // A custom view can't run until its rule set has loaded from the views
    // list — hold the query until then.
    enabled: !useUnified && !isSaved && (nav.kind !== 'custom' || activeViewFilters !== undefined),
  })

  const items: InboxItemDTO[] = useMemo(() => {
    if (useUnified) return unifiedData?.items ?? []
    return (legacyData?.conversations ?? []).map((conversation) => ({
      kind: 'conversation' as const,
      conversation,
      linkedTicket: null,
    }))
  }, [useUnified, unifiedData, legacyData])

  return { items, isLoading: useUnified ? unifiedLoading : legacyLoading }
}
