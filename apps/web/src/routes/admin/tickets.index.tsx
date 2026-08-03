import { createFileRoute } from '@tanstack/react-router'
import { createRouteErrorComponent } from '@/components/admin/shared'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { ticketQueries } from '@/lib/client/queries/tickets'
import type { TicketsSearch } from './tickets'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TicketQueueTable } from '@/components/admin/tickets/ticket-queue-table'
import { cn } from '@/lib/shared/utils'

export const Route = createFileRoute('/admin/tickets/')({
  loaderDeps: ({ search }) => ({
    scope: search.scope,
    statusCategory: search.statusCategory,
    search: search.search,
    inboxId: search.inboxId,
    sort: search.sort,
  }),
  loader: async ({ deps, context }) => {
    const { queryClient } = context as { queryClient: import('@tanstack/react-query').QueryClient }
    await Promise.all([
      queryClient.ensureQueryData(
        ticketQueries.list({
          scope: deps.scope ?? 'my_assigned',
          statusCategory: deps.statusCategory,
          search: deps.search,
          inboxId: deps.inboxId ?? null,
          sort: deps.sort,
        })
      ),
      queryClient.ensureQueryData(ticketQueries.statuses()),
    ])
  },
  pendingComponent: TicketsQueuePending,
  errorComponent: createRouteErrorComponent('Failed to load tickets'),
  component: TicketsQueuePage,
})

function TicketsQueuePending() {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

function TicketsQueuePage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [searchInput, setSearchInput] = useState(search.search ?? '')

  const params = useMemo(
    () => ({
      scope: search.scope ?? 'my_assigned',
      statusCategory: search.statusCategory,
      search: search.search,
      inboxId: search.inboxId ?? null,
      sort: search.sort,
    }),
    [search]
  )

  const queryOpts = ticketQueries.list(params)
  const { data } = useSuspenseQuery(queryOpts)
  const { data: statuses } = useSuspenseQuery(ticketQueries.statuses())

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border/50 px-4 py-2">
        <Input
          placeholder="Search subject…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              navigate({
                search: (s: TicketsSearch) => ({ ...s, search: searchInput || undefined }),
              })
            }
          }}
          className="max-w-xs h-8"
        />
        <div className="flex items-center gap-1 ml-2">
          {(['open', 'pending', 'on_hold', 'solved', 'closed'] as const).map((cat) => {
            const isActive = search.statusCategory === cat
            return (
              <button
                key={cat}
                onClick={() =>
                  navigate({
                    search: (s: TicketsSearch) => ({
                      ...s,
                      statusCategory: isActive ? undefined : cat,
                    }),
                  })
                }
                className={cn(
                  'px-2 py-1 text-xs font-medium rounded transition-colors',
                  isActive
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {cat.replace('_', ' ')}
              </button>
            )
          })}
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {data.total} ticket{data.total === 1 ? '' : 's'}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <TicketQueueTable
          rows={data.rows.map((r) => ({
            id: r.id,
            subject: r.subject,
            statusId: r.statusId as string,
            priority: r.priority,
            channel: r.channel,
            lastActivityAt: r.lastActivityAt,
            assigneePrincipalId: (r.assigneePrincipalId as string | null) ?? null,
          }))}
          statuses={statuses.map((s) => ({
            id: s.id as string,
            name: s.name,
            category: s.category as 'open' | 'pending' | 'on_hold' | 'solved' | 'closed',
          }))}
          invalidateKey={queryOpts.queryKey}
        />
      </div>
    </div>
  )
}
