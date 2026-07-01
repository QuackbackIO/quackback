import { useQuery } from '@tanstack/react-query'
import {
  ChatBubbleLeftRightIcon,
  InboxIcon,
  AtSymbolIcon,
  InboxArrowDownIcon,
  ChevronDownIcon,
  UserIcon,
  MagnifyingGlassIcon,
  BookmarkIcon,
} from '@heroicons/react/24/solid'
import type { ConversationTagId, SegmentId } from '@quackback/ids'
import { fetchConversationTagsWithCountsFn } from '@/lib/server/functions/conversation-tags'
import { fetchInboxSegmentsWithCountsFn } from '@/lib/server/functions/conversation-segments'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageHeader } from '@/components/shared/page-header'
import { FilterSection } from '@/components/shared/filter-section'
import { cn } from '@/lib/shared/utils'

// The active left-nav selection (one view / label / segment at a time) and its
// key live in lib/ so the route loader + query factory can share them without
// importing this component. Re-exported here so existing nav consumers are
// unaffected.
export {
  inboxNavKey,
  type InboxView,
  type InboxNavItem,
} from '@/lib/client/conversation/inbox-scope'
import {
  inboxNavKey,
  type InboxView,
  type InboxNavItem,
} from '@/lib/client/conversation/inbox-scope'

// Primary views are assignee-based queues — Mine / Unassigned / All — then the
// @-mentions feed and the personal "Saved for later" feed of flagged messages.
// Status is no longer a view; it's a list filter.
export const CONVERSATION_VIEWS = [
  { view: 'mine', label: 'Mine', Icon: UserIcon },
  { view: 'unassigned', label: 'Unassigned', Icon: InboxArrowDownIcon },
  { view: 'all', label: 'All', Icon: InboxIcon },
  { view: 'mentions', label: 'Mentions', Icon: AtSymbolIcon },
  { view: 'saved', label: 'Saved for later', Icon: BookmarkIcon },
] as const

/**
 * URL-safe guard: is `v` one of the canonical conversation views? Derived from
 * CONVERSATION_VIEWS so the route's `?view=` allowlist tracks the nav definition
 * and can't drift — a new view is accepted in the URL the moment it's listed
 * above, instead of needing a second hand-maintained list in validateSearch.
 */
export function isInboxView(v: unknown): v is InboxView {
  return typeof v === 'string' && CONVERSATION_VIEWS.some((c) => c.view === v)
}

export type ConversationTagWithCount = {
  id: ConversationTagId
  name: string
  color: string
  count: number
}

const CONVERSATION_TAG_COUNTS_KEY = ['admin', 'inbox', 'conversation-tags', 'counts'] as const

/** Shared (deduped) source of the labels + per-tag conversation counts. */
export function useConversationTagsWithCounts() {
  return useQuery({
    queryKey: CONVERSATION_TAG_COUNTS_KEY,
    queryFn: () => fetchConversationTagsWithCountsFn() as Promise<ConversationTagWithCount[]>,
    staleTime: 60_000,
  })
}

export type InboxSegmentWithCount = { id: SegmentId; name: string; color: string; count: number }

const INBOX_SEGMENT_COUNTS_KEY = ['admin', 'inbox', 'segments', 'counts'] as const

/** Shared (deduped) source of the segments + per-segment open-conversation counts. */
export function useInboxSegmentsWithCounts() {
  return useQuery({
    queryKey: INBOX_SEGMENT_COUNTS_KEY,
    queryFn: () => fetchInboxSegmentsWithCountsFn() as Promise<InboxSegmentWithCount[]>,
    staleTime: 60_000,
  })
}

/** Human label for the active scope, resolving a tag/segment id against its list. */
export function scopeLabelFor(
  nav: InboxNavItem,
  tags?: ConversationTagWithCount[],
  segments?: InboxSegmentWithCount[]
): string {
  if (nav.kind === 'tag') return tags?.find((t) => t.id === nav.tagId)?.name ?? 'Label'
  if (nav.kind === 'segment')
    return segments?.find((s) => s.id === nav.segmentId)?.name ?? 'Segment'
  return nav.view === 'mentions'
    ? 'Mentions'
    : nav.view === 'saved'
      ? 'Saved for later'
      : nav.view === 'mine'
        ? 'Mine'
        : nav.view === 'unassigned'
          ? 'Unassigned'
          : 'All conversations'
}

// Mirrors the settings secondary-nav item aesthetic (settings-nav.tsx) so the
// inbox left pane reads as part of the same admin design system.
const itemClass = (active: boolean) =>
  cn(
    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
    active
      ? 'bg-muted text-foreground'
      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
  )

/** A selectable scope row carrying a color + count (a PostTag or a Segment). */
type ScopeRow = { id: string; name: string; color: string; count: number }

/**
 * One collapsible nav group of color-dot scope rows (Tags or Segments). Renders
 * nothing when empty, so an org with no tags/segments shows no empty header. The
 * `makeItem` adapter turns a row id into the right `InboxNavItem` variant.
 */
function ScopeFilterSection({
  title,
  rows,
  activeKey,
  onSelect,
  makeItem,
}: {
  title: string
  rows: ScopeRow[]
  activeKey: string
  onSelect: (item: InboxNavItem) => void
  makeItem: (id: string) => InboxNavItem
}) {
  if (rows.length === 0) return null
  return (
    <FilterSection title={title}>
      <div className="space-y-1">
        {rows.map((r) => {
          const item = makeItem(r.id)
          const active = activeKey === inboxNavKey(item)
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onSelect(item)}
              className={itemClass(active)}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: r.color }}
              />
              <span className="min-w-0 flex-1 truncate text-left">{r.name}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{r.count}</span>
            </button>
          )
        })}
      </div>
    </FilterSection>
  )
}

/** The mobile (dropdown) equivalent of ScopeFilterSection. */
function ScopeMenuSection({
  title,
  rows,
  activeKey,
  onSelect,
  makeItem,
}: {
  title: string
  rows: ScopeRow[]
  activeKey: string
  onSelect: (item: InboxNavItem) => void
  makeItem: (id: string) => InboxNavItem
}) {
  if (rows.length === 0) return null
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </DropdownMenuLabel>
      {rows.map((r) => {
        const item = makeItem(r.id)
        return (
          <DropdownMenuItem
            key={r.id}
            onClick={() => onSelect(item)}
            className={cn('gap-2', activeKey === inboxNavKey(item) && 'text-primary')}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: r.color }}
            />
            <span className="min-w-0 flex-1 truncate">{r.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{r.count}</span>
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

const tagNavItem = (id: string): InboxNavItem => ({ kind: 'tag', tagId: id as ConversationTagId })
const segmentNavItem = (id: string): InboxNavItem => ({
  kind: 'segment',
  segmentId: id as SegmentId,
})

/**
 * Grouped inbox navigation: a Conversations group (Mine / Unassigned / All /
 * Mentions / Saved), a Tags group with per-tag conversation counts, and a
 * Segments group with per-segment open-conversation counts. PostTag and segment
 * scopes are mutually exclusive with each other and the views. Desktop-only
 * (lg+); the mobile equivalent is InboxScopeMenu in the list header.
 */
export function InboxNavSidebar({
  nav,
  onSelect,
  search,
  onSearch,
}: {
  nav: InboxNavItem
  onSelect: (item: InboxNavItem) => void
  search: string
  onSearch: (value: string) => void
}) {
  const { data: tags } = useConversationTagsWithCounts()
  const { data: segments } = useInboxSegmentsWithCounts()
  const activeKey = inboxNavKey(nav)

  return (
    <nav className="hidden w-64 shrink-0 flex-col border-r border-border/50 bg-card/30 lg:flex xl:w-72">
      <div className="px-4 py-3.5">
        <PageHeader icon={ChatBubbleLeftRightIcon} title="Conversations" />
      </div>
      {/* Search sits at the top of the pane, directly under the header. */}
      <div className="px-4 pb-3">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2.5 text-xs outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <FilterSection title="Conversations">
          <div className="space-y-1">
            {CONVERSATION_VIEWS.map(({ view, label, Icon }) => {
              const item: InboxNavItem = { kind: 'view', view }
              const active = activeKey === inboxNavKey(item)
              return (
                <button
                  key={view}
                  type="button"
                  onClick={() => onSelect(item)}
                  className={itemClass(active)}
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', active && 'text-primary')} />
                  {label}
                </button>
              )
            })}
          </div>
        </FilterSection>

        <ScopeFilterSection
          title="Tags"
          rows={tags ?? []}
          activeKey={activeKey}
          onSelect={onSelect}
          makeItem={tagNavItem}
        />
        <ScopeFilterSection
          title="Segments"
          rows={segments ?? []}
          activeKey={activeKey}
          onSelect={onSelect}
          makeItem={segmentNavItem}
        />
      </div>
    </nav>
  )
}

/**
 * Mobile scope switcher (lg:hidden) shown in the list header, since the nav
 * sidebar is desktop-only. Same options as the sidebar (views + tags +
 * segments), in a dropdown.
 */
export function InboxScopeMenu({
  nav,
  onSelect,
}: {
  nav: InboxNavItem
  onSelect: (item: InboxNavItem) => void
}) {
  const { data: tags } = useConversationTagsWithCounts()
  const { data: segments } = useInboxSegmentsWithCounts()
  const activeKey = inboxNavKey(nav)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-sm font-semibold leading-tight"
        >
          <span className="truncate">{scopeLabelFor(nav, tags, segments)}</span>
          <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Conversations
        </DropdownMenuLabel>
        {CONVERSATION_VIEWS.map(({ view, label, Icon }) => {
          const item: InboxNavItem = { kind: 'view', view }
          return (
            <DropdownMenuItem
              key={view}
              onClick={() => onSelect(item)}
              className={cn('gap-2', activeKey === inboxNavKey(item) && 'text-primary')}
            >
              <Icon className="h-4 w-4" />
              {label}
            </DropdownMenuItem>
          )
        })}
        <ScopeMenuSection
          title="Tags"
          rows={tags ?? []}
          activeKey={activeKey}
          onSelect={onSelect}
          makeItem={tagNavItem}
        />
        <ScopeMenuSection
          title="Segments"
          rows={segments ?? []}
          activeKey={activeKey}
          onSelect={onSelect}
          makeItem={segmentNavItem}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
