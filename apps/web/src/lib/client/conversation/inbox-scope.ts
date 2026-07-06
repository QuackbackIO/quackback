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
import type { TicketType } from '@/lib/shared/db-types'
import {
  facetToConversationStatus,
  isInboxTriageFacet,
  INBOX_TRIAGE_FACETS,
  type InboxTriageFacet,
} from '@/lib/shared/inbox/items'

// Re-exported so route/component code can pull the facet type from the one
// scope module instead of reaching into lib/shared/inbox/items directly.
export { INBOX_TRIAGE_FACETS, isInboxTriageFacet, type InboxTriageFacet }

export type InboxView =
  | 'mine'
  | 'unassigned'
  | 'all'
  | 'mentions'
  | 'saved'
  | 'quinn'
  // UNIFIED-INBOX-SPEC.md §2.3: the Tickets nav section. A separate group in
  // the sidebar (see inbox-nav-sidebar.tsx), but the same InboxView/InboxNavItem
  // machinery carries them through the URL + query layer.
  | 'tickets_customer'
  | 'tickets_back_office'
  | 'tickets_tracker'

const TICKET_VIEW_TYPE: Record<
  'tickets_customer' | 'tickets_back_office' | 'tickets_tracker',
  TicketType
> = {
  tickets_customer: 'customer',
  tickets_back_office: 'back_office',
  tickets_tracker: 'tracker',
}

/** Whether a view is one of the three Tickets-section scopes. */
export function isTicketInboxView(
  view: InboxView
): view is 'tickets_customer' | 'tickets_back_office' | 'tickets_tracker' {
  return view === 'tickets_customer' || view === 'tickets_back_office' || view === 'tickets_tracker'
}

/** The ticket `type` a Tickets-section view scopes the unified list to. */
export function ticketTypeForView(
  view: 'tickets_customer' | 'tickets_back_office' | 'tickets_tracker'
): TicketType {
  return TICKET_VIEW_TYPE[view]
}

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

/** Inbox URL search params — the source of truth for the open item + filters. */
export interface InboxSearch {
  /** The unified selection param (UNIFIED-INBOX-SPEC.md §2.2): a conversation OR
   *  ticket TypeID, discriminated by prefix via `inboxItemRefFromId`. */
  i?: string
  /** Legacy alias for `i`, accepted forever (existing deep links in notification
   *  emails, conversation.convert.ts, conversation.notify.ts). `validateSearch`
   *  normalizes `c=X` to `i=X`. */
  c?: string
  /** Deep-link target message within the open item — scrolled to + flashed on open. */
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
  /** The triage facet (open/waiting/closed/all) — replaces the old per-status
   *  filter. Legacy `snoozed` values normalize to `waiting` (see
   *  `normalizeTriageFacet`). */
  status?: InboxTriageFacet
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

// ---------------------------------------------------------------------------
// Triage facet (UNIFIED-INBOX-SPEC.md §2.2/§2.4) — the URL-level `status` param.
// ---------------------------------------------------------------------------

/**
 * Parse the `?status=` param into a facet, accepting the legacy `snoozed`
 * value (pre-unified-inbox bookmarks/links) as `waiting`. Anything else
 * unrecognized falls back to `undefined` (the caller defaults to 'open').
 */
export function normalizeTriageFacet(v: unknown): InboxTriageFacet | undefined {
  if (v === 'snoozed') return 'waiting'
  if (isInboxTriageFacet(v)) return v
  return undefined
}

/**
 * Adapt a triage facet to the legacy `StatusFilter` shape `buildListParams`
 * (and the conversation-inbox query factory) expect — the scopes that still
 * run the pre-unified-inbox conversation-only list (mentions/quinn/saved,
 * tag/segment/custom views) keep calling `buildListParams` unchanged, so its
 * `ConversationStatus | 'all'` contract can't drift. `waiting` maps back to
 * `snoozed`; `all` has no conversation-status equivalent.
 */
export function facetToStatusFilter(facet: InboxTriageFacet): StatusFilter {
  return facetToConversationStatus(facet) ?? 'all'
}

// ---------------------------------------------------------------------------
// Unified list params (UNIFIED-INBOX-SPEC.md §3.1) — the subset of
// InboxNavItem scopes the unified `listInboxItemsFn` endpoint actually
// supports today: assignee queues (mine/unassigned/all), a per-team inbox,
// and the three Tickets-section scopes. Tag/segment/custom/mentions/quinn/
// saved stay on the legacy `buildListParams` + conversation-only endpoint
// (see the inbox route report — the unified endpoint's filter has no
// tagIds/segmentIds/mentionedPrincipalId/assistantStatuses support yet).
// ---------------------------------------------------------------------------

/** The subset of `ConversationSort` the unified endpoint's `inboxSortSchema`
 *  accepts. `waiting`/`sla` are conversation-only sorts with no ticket-row
 *  equivalent (§3.1 documents they'd rank ticket rows by activity) — the
 *  endpoint's zod schema simply rejects them today, so the client must clamp
 *  rather than forward and 400. */
const INBOX_UNIFIED_SORTS = new Set(['recent', 'oldest', 'created', 'priority'])

export interface InboxListParams {
  facet: InboxTriageFacet
  kinds?: Array<'conversation' | 'ticket'>
  ticketType?: TicketType
  priority?: ConversationPriority
  search?: string
  assignee?: string
  teamId?: string
  companyId?: string
  sort?: 'recent' | 'oldest' | 'created' | 'priority'
}

/**
 * Whether `nav` is one of the scopes the unified `listInboxItemsFn` endpoint
 * supports (mine/unassigned/all, a per-team inbox, or a Tickets-section
 * scope). Everything else (tag/segment/custom/mentions/quinn/saved) stays on
 * the legacy conversation-only endpoint via `buildListParams`.
 */
export function usesUnifiedInboxList(nav: InboxNavItem): boolean {
  if (nav.kind === 'team') return true
  if (nav.kind === 'view') {
    return (
      nav.view === 'mine' ||
      nav.view === 'unassigned' ||
      nav.view === 'all' ||
      isTicketInboxView(nav.view)
    )
  }
  return false
}

/**
 * Map the active nav scope + triage facet + filter chips to the unified
 * endpoint's list filter. Only called for the scopes the endpoint supports
 * (see the module note above); the route picks `buildListParams` instead for
 * everything else.
 */
export function buildInboxListParams(
  nav: InboxNavItem,
  facet: InboxTriageFacet,
  priorityFilter: ConversationPriority | 'all',
  search: string,
  companyId?: CompanyId,
  sort?: ConversationSort
): InboxListParams {
  const priority = priorityFilter === 'all' ? undefined : priorityFilter
  const searchParam = search || undefined
  const company = companyId || undefined
  const sortParam: InboxListParams['sort'] =
    sort && sort !== 'recent' && INBOX_UNIFIED_SORTS.has(sort)
      ? (sort as InboxListParams['sort'])
      : undefined

  if (nav.kind === 'team') {
    return {
      facet,
      kinds: ['conversation'],
      teamId: nav.teamId,
      priority,
      search: searchParam,
      companyId: company,
      sort: sortParam,
    }
  }
  if (nav.kind === 'view' && isTicketInboxView(nav.view)) {
    return {
      facet,
      kinds: ['ticket'],
      ticketType: ticketTypeForView(nav.view),
      priority,
      search: searchParam,
      companyId: company,
      sort: sortParam,
    }
  }
  if (nav.kind === 'view' && nav.view === 'all') {
    return {
      facet,
      kinds: ['conversation', 'ticket'],
      priority,
      search: searchParam,
      companyId: company,
      sort: sortParam,
    }
  }
  // 'mine' | 'unassigned' — the only other scopes this function is called for.
  const assignee =
    nav.kind === 'view' && nav.view === 'mine'
      ? 'me'
      : nav.kind === 'view' && nav.view === 'unassigned'
        ? 'unassigned'
        : undefined
  return {
    facet,
    kinds: ['conversation'],
    assignee,
    priority,
    search: searchParam,
    companyId: company,
    sort: sortParam,
  }
}
