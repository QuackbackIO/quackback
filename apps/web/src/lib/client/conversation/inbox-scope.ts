/**
 * Pure URL-scope logic for the support inbox: the nav-scope discriminated union
 * and its key, plus the URL→params derivation. Lives in lib/ (not components/)
 * because the route loader's SSR prefetch and the query factory both need it,
 * and lib/ may not import components/. Free of React/server imports so it's
 * unit-tested directly; the nav-sidebar component re-exports the nav types.
 */
import type {
  ConversationTagId,
  SegmentId,
  CompanyId,
  TeamId,
  ConversationViewId,
} from '@quackback/ids'
import type { ConversationStatus, ConversationPriority } from '@/lib/shared/conversation/types'
import type { ConversationSort, ConversationViewListParams } from '@/lib/shared/conversation/views'

export type InboxView = 'mine' | 'unassigned' | 'all' | 'mentions' | 'saved' | 'quinn'

/** Quinn-inbox sub-filter by involvement outcome (Fin's Resolved/Escalated/Pending). */
export type AiBucket = 'resolved' | 'escalated' | 'pending'

/**
 * The active left-nav selection — one built-in view, one label, one segment,
 * one team inbox, or one custom saved view at a time. Scopes are mutually
 * exclusive; the URL carries exactly one.
 */
export type InboxNavItem =
  | { kind: 'view'; view: InboxView }
  | { kind: 'tag'; tagId: ConversationTagId }
  | { kind: 'segment'; segmentId: SegmentId }
  | { kind: 'team'; teamId: TeamId }
  | { kind: 'custom'; viewId: ConversationViewId }

/** Stable identity for query keys + active-state comparison. */
export function inboxNavKey(nav: InboxNavItem): string {
  if (nav.kind === 'tag') return `tag:${nav.tagId}`
  if (nav.kind === 'segment') return `segment:${nav.segmentId}`
  if (nav.kind === 'team') return `team:${nav.teamId}`
  if (nav.kind === 'custom') return `custom:${nav.viewId}`
  return `view:${nav.view}`
}

/** A real conversation status, or 'all' = no status filter. */
export type StatusFilter = ConversationStatus | 'all'

export const PRIORITY_VALUES = ['all', 'none', 'low', 'medium', 'high', 'urgent'] as const

/** Inbox URL search params — the source of truth for the open conversation + filters. */
export interface InboxSearch {
  c?: string
  /** Deep-link target message within `c` — scrolled to + flashed on open. */
  m?: string
  view?: InboxView
  /** Quinn-view sub-filter by involvement outcome; omitted = any Quinn-engaged. */
  ai?: AiBucket
  tag?: string
  segment?: string
  /** Per-team inbox scope (a team id). */
  team?: string
  /** Custom saved view scope (a conversation-view id). */
  viewId?: string
  status?: StatusFilter
  priority?: ConversationPriority | 'all'
  /** Inbox ordering; omitted = the default 'recent'. */
  sort?: ConversationSort
  q?: string
  /** Company refinement (deep-linked from the conversation CompanyCard): restrict
   *  the list to conversations whose visitor belongs to this company. */
  company?: string
  /** Open post for the shared `?post=` modal (the whole admin layout mounts it).
   *  Set when an embedded post card in a conversation message is clicked; must be carried
   *  here or this route's validateSearch would strip it before the modal sees it. */
  post?: string
}

/**
 * Resolve the active left-nav scope from the URL. Scopes are mutually exclusive;
 * precedence custom > team > tag > segment > view if the URL somehow carries
 * more than one.
 */
export function navFromSearch(search: InboxSearch): InboxNavItem {
  if (search.viewId) return { kind: 'custom', viewId: search.viewId as ConversationViewId }
  if (search.team) return { kind: 'team', teamId: search.team as TeamId }
  if (search.tag) return { kind: 'tag', tagId: search.tag as ConversationTagId }
  if (search.segment) return { kind: 'segment', segmentId: search.segment as SegmentId }
  return { kind: 'view', view: search.view ?? 'all' }
}

/**
 * Map the active nav scope + filter chips to the list-query params. The primary
 * views ARE the assignee queue (Mine / Unassigned / All); Mentions is a personal
 * feed; a Label/Segment/team scope refines by tag/segment/team; a custom view
 * carries its own pre-translated rule set (`customParams`). Status + priority are
 * optional chips ('all' = unset), applied within any non-Mentions built-in
 * scope. The optional company refinement + sort narrow/order any scope.
 */
export function buildListParams(
  nav: InboxNavItem,
  status: StatusFilter,
  priorityFilter: ConversationPriority | 'all',
  search: string,
  companyId?: CompanyId,
  sort?: ConversationSort,
  customParams?: ConversationViewListParams,
  aiBucket?: AiBucket
) {
  const priority = priorityFilter === 'all' ? undefined : priorityFilter
  const statusParam = status === 'all' ? undefined : status
  const q = search || undefined
  const company = companyId || undefined
  // The default sort is implicit server-side, so omit it to keep query keys +
  // params byte-stable with the pre-sort behavior.
  const sortParam = sort && sort !== 'recent' ? sort : undefined
  if (nav.kind === 'custom')
    return { ...(customParams ?? {}), search: q, companyId: company, sort: sortParam }
  if (nav.kind === 'team')
    return {
      teamId: nav.teamId,
      status: statusParam,
      priority,
      search: q,
      companyId: company,
      sort: sortParam,
    }
  if (nav.kind === 'tag')
    return {
      tagIds: [nav.tagId],
      status: statusParam,
      priority,
      search: q,
      companyId: company,
      sort: sortParam,
    }
  if (nav.kind === 'segment')
    return {
      segmentIds: [nav.segmentId],
      status: statusParam,
      priority,
      search: q,
      companyId: company,
      sort: sortParam,
    }
  if (nav.view === 'mentions')
    return { view: 'mentions' as const, search: q, companyId: company, sort: sortParam }
  if (nav.view === 'quinn')
    return {
      view: 'quinn' as const,
      ai: aiBucket,
      status: statusParam,
      priority,
      search: q,
      companyId: company,
      sort: sortParam,
    }
  const assignee =
    nav.view === 'mine'
      ? ('mine' as const)
      : nav.view === 'unassigned'
        ? ('unassigned' as const)
        : ('all' as const)
  return { status: statusParam, priority, assignee, search: q, companyId: company, sort: sortParam }
}
