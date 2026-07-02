/**
 * Left-rail sidebar for the tickets queue. Renders saved-view buttons and an
 * expandable "By inbox" group of inboxes the actor is a member of.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  InboxIcon,
  UserIcon,
  UsersIcon,
  ShareIcon,
  QuestionMarkCircleIcon,
  GlobeAltIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { useMyInboxes } from '@/lib/client/hooks/use-inboxes-queries'
import { cn } from '@/lib/shared/utils'
import type { TicketsSearch } from '@/routes/admin/tickets'

interface SavedView {
  scope: TicketsSearch['scope']
  label: string
  icon: typeof InboxIcon
}

const SAVED_VIEWS: SavedView[] = [
  { scope: 'my_assigned', label: 'Assigned to me', icon: UserIcon },
  { scope: 'my_team', label: 'My team', icon: UsersIcon },
  { scope: 'shared_with_me', label: 'Shared with me', icon: ShareIcon },
  { scope: 'unassigned', label: 'Unassigned', icon: QuestionMarkCircleIcon },
  { scope: 'my_inbox', label: 'My inboxes', icon: InboxIcon },
  { scope: 'all', label: 'All', icon: GlobeAltIcon },
]

export interface TicketQueueSidebarProps {
  activeScope: TicketsSearch['scope']
  activeInboxId?: string
}

export function TicketQueueSidebar({ activeScope, activeInboxId }: TicketQueueSidebarProps) {
  const [inboxesOpen, setInboxesOpen] = useState(true)
  const myInboxesQuery = useMyInboxes()

  return (
    <aside className="w-60 shrink-0 border-r border-border/50 bg-background overflow-y-auto py-3">
      <nav className="px-2 space-y-0.5">
        {SAVED_VIEWS.map((v) => {
          const Icon = v.icon
          const isActive = activeScope === v.scope && !activeInboxId
          return (
            <Link
              key={v.scope}
              to="/admin/tickets"
              search={{ scope: v.scope } as TicketsSearch}
              className={cn(
                'flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{v.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mt-4 px-2">
        <button
          type="button"
          onClick={() => setInboxesOpen((v) => !v)}
          className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        >
          {inboxesOpen ? (
            <ChevronDownIcon className="h-3 w-3" />
          ) : (
            <ChevronRightIcon className="h-3 w-3" />
          )}
          By inbox
        </button>
        {inboxesOpen && (
          <div className="mt-1 space-y-0.5">
            {myInboxesQuery.isLoading && (
              <div className="px-2 py-1 text-xs text-muted-foreground">Loading…</div>
            )}
            {myInboxesQuery.data?.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">No inboxes</div>
            )}
            {myInboxesQuery.data?.map((inbox) => {
              const isActive = activeScope === 'inbox' && activeInboxId === inbox.id
              return (
                <Link
                  key={inbox.id}
                  to="/admin/tickets"
                  search={{ scope: 'inbox', inboxId: inbox.id } as TicketsSearch}
                  className={cn(
                    'flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  )}
                >
                  <InboxIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{inbox.name}</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </aside>
  )
}
