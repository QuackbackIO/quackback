import { useState } from 'react'
import type { ConversationId } from '@quackback/ids'
import type {
  ConversationDTO,
  ConversationPriority,
  ConversationStatus,
} from '@/lib/shared/conversation/types'
import { ChevronDownIcon, PencilSquareIcon } from '@heroicons/react/24/solid'
import { NewConversationDialog } from '@/components/admin/chat/new-conversation-dialog'
import { priorityMeta } from '@/lib/shared/conversation/priority-meta'
import { PriorityDot, PriorityMenuItems } from '@/components/admin/chat/priority-control'
import { ChannelBadge } from '@/components/admin/chat/channel-badge'
import { InboxScopeMenu, type InboxNavItem } from '@/components/admin/chat/inbox-nav-sidebar'
import { TagChip } from '@/components/shared/tag-chip'
import { Spinner } from '@/components/shared/spinner'
import { Avatar } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/shared/utils'

/** Status filter: a real status, or 'all' (no status filter applied). */
type StatusFilter = ConversationStatus | 'all'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/** The empty-list message for the active scope + status filter. */
function emptyStateMessage(nav: InboxNavItem, status: StatusFilter, scopeLabel: string): string {
  if (nav.kind === 'tag') return `No conversations labelled ${scopeLabel}`
  if (nav.kind === 'segment') {
    const part = status === 'all' ? '' : `${status} `
    return `No ${part}conversations from ${scopeLabel}`
  }
  if (nav.view === 'mentions') return 'No conversations mention you yet'
  const statusPart = status === 'all' ? '' : `${status} `
  if (nav.view === 'mine') return `No ${statusPart}conversations assigned to you`
  if (nav.view === 'unassigned') return `No ${statusPart}unassigned conversations`
  return `No ${statusPart}conversations`
}

interface ConversationListColumnProps {
  nav: InboxNavItem
  onSelectNav: (item: InboxNavItem) => void
  scopeLabel: string
  /** Whether to show the status/priority filter chips (hidden for the Mentions feed). */
  showRefinements: boolean
  /** Search input, mirrored from the nav sidebar (the list keeps a copy for the
   *  sub-lg layout where the nav pane is hidden). */
  searchInput: string
  onSearchInput: (value: string) => void
  status: StatusFilter
  onStatus: (value: StatusFilter) => void
  priorityFilter: ConversationPriority | 'all'
  onPriorityFilter: (value: ConversationPriority | 'all') => void
  loading: boolean
  conversations: ConversationDTO[]
  selectedId: ConversationId | null
  onSelect: (id: ConversationId) => void
}

/**
 * The middle column of the inbox: scope header (desktop label / mobile scope
 * menu), search, the assignee/status/priority refinements, and the conversation
 * list itself. Purely presentational — all state lives in the inbox route.
 */
export function ConversationListColumn({
  nav,
  onSelectNav,
  scopeLabel,
  showRefinements,
  searchInput,
  onSearchInput,
  status,
  onStatus,
  priorityFilter,
  onPriorityFilter,
  loading,
  conversations,
  selectedId,
  onSelect,
}: ConversationListColumnProps) {
  const [composeOpen, setComposeOpen] = useState(false)
  return (
    <div
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col border-r border-border/50 md:w-80',
        // On mobile the list and thread are one column: hide the list while a
        // conversation is open (a back button returns to it).
        selectedId && 'hidden md:flex'
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-[0.85rem]">
        {/* At lg+ the nav sidebar owns scope selection, so the header is a
            plain label. Below lg the sidebar is hidden, so offer a dropdown. */}
        <h2 className="hidden min-w-0 truncate text-sm font-semibold leading-tight lg:block">
          {scopeLabel}
        </h2>
        <div className="min-w-0 lg:hidden">
          <InboxScopeMenu nav={nav} onSelect={onSelectNav} />
        </div>
        <button
          type="button"
          onClick={() => setComposeOpen(true)}
          title="New conversation"
          aria-label="New conversation"
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PencilSquareIcon className="size-4" />
        </button>
      </div>
      <NewConversationDialog open={composeOpen} onOpenChange={setComposeOpen} />
      {/* Search is owned by the nav pane at lg+; the list keeps a copy for the
          sub-lg layout where that pane is hidden. */}
      <div className="px-3 pt-2 lg:hidden">
        <input
          type="search"
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
          placeholder="Search conversations…"
          aria-label="Search conversations"
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
      {showRefinements && (
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none px-3 py-2">
          {/* Status is a removable filter chip (mirrors the feedback inbox) — not
              a primary view. 'all' = no status filter. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  status !== 'all'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                <span className="capitalize">{status === 'all' ? 'Status' : status}</span>
                <ChevronDownIcon className="h-3 w-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => onStatus('all')} className="text-xs">
                All statuses
              </DropdownMenuItem>
              {(['open', 'pending', 'closed'] as const).map((s) => (
                <DropdownMenuItem
                  key={s}
                  onClick={() => onStatus(s)}
                  className="text-xs capitalize"
                >
                  {s}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Filter by priority"
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors',
                  priorityFilter !== 'all'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                <PriorityDot priority={priorityFilter === 'all' ? 'none' : priorityFilter} />
                {priorityFilter === 'all' ? 'Priority' : priorityMeta(priorityFilter).label}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onPriorityFilter('all')} className="text-xs">
                All priorities
              </DropdownMenuItem>
              <PriorityMenuItems
                selected={priorityFilter === 'all' ? undefined : priorityFilter}
                onSelect={onPriorityFilter}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : conversations.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            {emptyStateMessage(nav, status, scopeLabel)}
          </div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                'flex w-full items-start gap-2.5 border-b border-border/30 px-3 py-3 text-left transition-colors',
                selectedId === c.id ? 'bg-muted/60' : 'hover:bg-muted/30'
              )}
            >
              <Avatar
                src={c.visitor.avatarUrl}
                name={c.visitor.displayName ?? 'Visitor'}
                className="size-8 shrink-0 text-xs"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <PriorityDot priority={c.priority} />
                    <span className="truncate text-sm font-medium">
                      {c.visitor.displayName ?? 'Visitor'}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {relativeTime(c.lastMessageAt)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {c.lastMessagePreview ?? c.subject ?? 'No messages yet'}
                </p>
                {(c.channel !== 'messenger' || c.tags.length > 0) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {c.channel !== 'messenger' && <ChannelBadge channel={c.channel} />}
                    {c.tags.map((t) => (
                      <TagChip
                        key={t.id}
                        name={t.name}
                        color={t.color}
                        className="px-1.5 py-0 text-[10px]"
                      />
                    ))}
                  </div>
                )}
              </div>
              {c.unreadCount > 0 && (
                <span className="mt-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                  {c.unreadCount}
                </span>
              )}
            </button>
          ))
        )}
      </ScrollArea>
    </div>
  )
}
