/**
 * Pure URL-scope logic for the support inbox: the nav-scope discriminated union
 * and its key, plus the URL→params derivation. Lives in lib/ (not components/)
 * because the route loader's SSR prefetch and the query factory both need it,
 * and lib/ may not import components/. Free of React/server imports so it's
 * unit-tested directly; the nav-sidebar component re-exports the nav types.
 */
import type { ConversationTagId, SegmentId } from '@quackback/ids'
import type { ConversationStatus, ConversationPriority } from '@/lib/shared/conversation/types'

export type InboxView = 'mine' | 'unassigned' | 'all' | 'mentions' | 'saved'

/** The active left-nav selection — one view, one label, or one segment at a time. */
export type InboxNavItem =
  | { kind: 'view'; view: InboxView }
  | { kind: 'tag'; tagId: ConversationTagId }
  | { kind: 'segment'; segmentId: SegmentId }

/** Stable identity for query keys + active-state comparison. */
export function inboxNavKey(nav: InboxNavItem): string {
  if (nav.kind === 'tag') return `tag:${nav.tagId}`
  if (nav.kind === 'segment') return `segment:${nav.segmentId}`
  return `view:${nav.view}`
}

/** A real conversation status, or 'all' = no status filter. */
export type StatusFilter = ConversationStatus | 'all'

export const PRIORITY_VALUES = ['all', 'none', 'low', 'medium', 'high', 'urgent'] as const

/** Inbox URL search params — the source of truth for the open chat + filters. */
export interface InboxSearch {
  c?: string
  /** Deep-link target message within `c` — scrolled to + flashed on open. */
  m?: string
  view?: InboxView
  tag?: string
  segment?: string
  status?: StatusFilter
  priority?: ConversationPriority | 'all'
  q?: string
  /** Open post for the shared `?post=` modal (the whole admin layout mounts it).
   *  Set when an embedded post card in a chat message is clicked; must be carried
   *  here or this route's validateSearch would strip it before the modal sees it. */
  post?: string
}

/**
 * Resolve the active left-nav scope from the URL. Scopes are mutually exclusive;
 * tag wins over segment wins over view if the URL somehow carries more than one.
 */
export function navFromSearch(search: InboxSearch): InboxNavItem {
  if (search.tag) return { kind: 'tag', tagId: search.tag as ConversationTagId }
  if (search.segment) return { kind: 'segment', segmentId: search.segment as SegmentId }
  return { kind: 'view', view: search.view ?? 'all' }
}

/**
 * Map the active nav scope + filter chips to the list-query params. The primary
 * views ARE the assignee queue (Mine / Unassigned / All); Mentions is a personal
 * feed; a Label/Segment scope refines by tag/segment. Status + priority are
 * optional chips ('all' = unset), applied within any non-Mentions scope.
 */
export function buildListParams(
  nav: InboxNavItem,
  status: StatusFilter,
  priorityFilter: ConversationPriority | 'all',
  search: string
) {
  const priority = priorityFilter === 'all' ? undefined : priorityFilter
  const statusParam = status === 'all' ? undefined : status
  const q = search || undefined
  if (nav.kind === 'tag') return { tagIds: [nav.tagId], status: statusParam, priority, search: q }
  if (nav.kind === 'segment')
    return { segmentIds: [nav.segmentId], status: statusParam, priority, search: q }
  if (nav.view === 'mentions') return { view: 'mentions' as const, search: q }
  const assignee =
    nav.view === 'mine'
      ? ('mine' as const)
      : nav.view === 'unassigned'
        ? ('unassigned' as const)
        : ('all' as const)
  return { status: statusParam, priority, assignee, search: q }
}
