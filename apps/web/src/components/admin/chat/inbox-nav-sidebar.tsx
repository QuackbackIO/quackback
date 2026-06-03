import { useQuery } from '@tanstack/react-query'
import {
  ChatBubbleLeftRightIcon,
  InboxIcon,
  AtSymbolIcon,
  InboxArrowDownIcon,
  ChevronDownIcon,
  UserIcon,
  MagnifyingGlassIcon,
  FlagIcon,
} from '@heroicons/react/24/solid'
import type { ChatTagId } from '@quackback/ids'
import { fetchChatTagsWithCountsFn } from '@/lib/server/functions/chat-tags'
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

/**
 * The active left-nav selection. A single item is highlighted at a time: one of
 * the Conversations views, or one Label. Assignee/status/search in the list
 * header refine WITHIN the selected scope. Carries only ids so it round-trips
 * through the URL; the label is resolved from the fetched tag list.
 */
export type InboxView = 'mine' | 'unassigned' | 'all' | 'mentions' | 'saved'
export type InboxNavItem = { kind: 'view'; view: InboxView } | { kind: 'tag'; tagId: ChatTagId }

/** Stable identity for query keys + active-state comparison. */
export function inboxNavKey(nav: InboxNavItem): string {
  return nav.kind === 'tag' ? `tag:${nav.tagId}` : `view:${nav.view}`
}

// Primary views are assignee-based queues — Mine / Unassigned / All — then the
// @-mentions feed and the personal "Saved for later" feed of flagged messages.
// Status is no longer a view; it's a list filter.
export const CONVERSATION_VIEWS = [
  { view: 'mine', label: 'Mine', Icon: UserIcon },
  { view: 'unassigned', label: 'Unassigned', Icon: InboxArrowDownIcon },
  { view: 'all', label: 'All', Icon: InboxIcon },
  { view: 'mentions', label: 'Mentions', Icon: AtSymbolIcon },
  { view: 'saved', label: 'Saved for later', Icon: FlagIcon },
] as const

export type ChatTagWithCount = { id: ChatTagId; name: string; color: string; count: number }

const CHAT_TAG_COUNTS_KEY = ['admin', 'inbox', 'chat-tags', 'counts'] as const

/** Shared (deduped) source of the labels + per-tag conversation counts. */
export function useChatTagsWithCounts() {
  return useQuery({
    queryKey: CHAT_TAG_COUNTS_KEY,
    queryFn: () => fetchChatTagsWithCountsFn() as Promise<ChatTagWithCount[]>,
    staleTime: 60_000,
  })
}

/** Human label for the active scope, resolving a tag id against the tag list. */
export function scopeLabelFor(nav: InboxNavItem, tags?: ChatTagWithCount[]): string {
  if (nav.kind === 'tag') return tags?.find((t) => t.id === nav.tagId)?.name ?? 'Label'
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

/**
 * Grouped inbox navigation: a Conversations group (Mine / Unassigned / All /
 * Mentions) and a Tags group with per-tag conversation counts. Desktop-only
 * (md+); the
 * mobile equivalent is InboxScopeMenu in the list header.
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
  const { data: tags } = useChatTagsWithCounts()
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

        {tags && tags.length > 0 && (
          <FilterSection title="Tags">
            <div className="space-y-1">
              {tags.map((t) => {
                const item: InboxNavItem = { kind: 'tag', tagId: t.id }
                const active = activeKey === inboxNavKey(item)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onSelect(item)}
                    className={itemClass(active)}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-left">{t.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{t.count}</span>
                  </button>
                )
              })}
            </div>
          </FilterSection>
        )}
      </div>
    </nav>
  )
}

/**
 * Mobile scope switcher (md:hidden) shown in the list header, since the nav
 * sidebar is desktop-only. Same options as the sidebar, in a dropdown.
 */
export function InboxScopeMenu({
  nav,
  onSelect,
}: {
  nav: InboxNavItem
  onSelect: (item: InboxNavItem) => void
}) {
  const { data: tags } = useChatTagsWithCounts()
  const activeKey = inboxNavKey(nav)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 text-sm font-semibold leading-tight"
        >
          <span className="truncate">{scopeLabelFor(nav, tags)}</span>
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
        {tags && tags.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Tags
            </DropdownMenuLabel>
            {tags.map((t) => {
              const item: InboxNavItem = { kind: 'tag', tagId: t.id }
              return (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => onSelect(item)}
                  className={cn('gap-2', activeKey === inboxNavKey(item) && 'text-primary')}
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{t.count}</span>
                </DropdownMenuItem>
              )
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
