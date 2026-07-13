/**
 * Lists all tickets the current principal is subscribed to. Allows
 * bulk unsubscribe via sequential mutations (page-size N is small).
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BellIcon, BellSlashIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/empty-state'
import { Spinner } from '@/components/shared/spinner'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  TicketPriorityChip,
  type TicketPriority,
} from '@/components/admin/tickets/ticket-priority-chip'
import {
  listMyTicketSubscriptionsFn,
  unsubscribeFromTicketFn,
} from '@/lib/server/functions/notifications'

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual',
  auto_assigned: 'Auto · assignee',
  auto_participant: 'Auto · participant',
  auto_team_member: 'Auto · team',
}

export function MyTicketSubscriptionsPanel() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [unsubscribing, setUnsubscribing] = useState(false)

  const query = useInfiniteQuery({
    queryKey: ['tickets', 'my-subscriptions'] as const,
    initialPageParam: null as { createdAt: string; id: string } | null,
    queryFn: ({ pageParam }) =>
      listMyTicketSubscriptionsFn({
        data: { limit: 50, cursor: pageParam ?? undefined },
      }),
    getNextPageParam: (last) => last.nextCursor,
  })

  const unsubscribeOne = useMutation({
    mutationFn: (ticketId: string) => unsubscribeFromTicketFn({ data: { ticketId } }),
  })

  const subscriptions = query.data?.pages.flatMap((p) => p.subscriptions) ?? []

  function toggle(ticketId: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(ticketId)
      else next.delete(ticketId)
      return next
    })
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(subscriptions.map((s) => s.ticketId)) : new Set())
  }

  async function bulkUnsubscribe() {
    if (selected.size === 0) return
    setUnsubscribing(true)
    let ok = 0
    let failed = 0
    for (const ticketId of selected) {
      try {
        await unsubscribeOne.mutateAsync(ticketId)
        ok += 1
      } catch {
        failed += 1
      }
    }
    setSelected(new Set())
    setUnsubscribing(false)
    qc.invalidateQueries({ queryKey: ['tickets', 'my-subscriptions'] })
    if (failed === 0) {
      toast.success(`Unsubscribed from ${ok} ticket${ok === 1 ? '' : 's'}`)
    } else {
      toast.error(`Unsubscribed from ${ok}; ${failed} failed`)
    }
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="xl" />
      </div>
    )
  }

  if (subscriptions.length === 0) {
    return (
      <EmptyState
        icon={BellIcon}
        title="No ticket subscriptions yet"
        description="Subscribe to a ticket from its detail page to get notified about updates."
        className="py-24"
      />
    )
  }

  const allSelected = selected.size === subscriptions.length
  const someSelected = selected.size > 0 && !allSelected

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border/50">
        <Checkbox
          checked={allSelected ? true : someSelected ? 'indeterminate' : false}
          onCheckedChange={(v) => toggleAll(v === true)}
          aria-label="Select all"
        />
        <span className="text-sm text-muted-foreground">
          {selected.size > 0
            ? `${selected.size} selected`
            : `${subscriptions.length} subscription${subscriptions.length === 1 ? '' : 's'}`}
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={bulkUnsubscribe}
            disabled={selected.size === 0 || unsubscribing}
          >
            <BellSlashIcon className="h-4 w-4 mr-1" />
            Unsubscribe selected
          </Button>
        </div>
      </div>
      <ul className="divide-y divide-border/50">
        {subscriptions.map((s) => {
          const isMuted = s.mutedUntil && new Date(s.mutedUntil).getTime() > Date.now()
          return (
            <li key={s.id} className="flex items-center gap-3 px-6 py-3">
              <Checkbox
                checked={selected.has(s.ticketId)}
                onCheckedChange={(v) => toggle(s.ticketId, v === true)}
                aria-label={`Select ticket ${s.ticket.subject ?? s.ticketId}`}
              />
              <div className="flex-1 min-w-0">
                <Link
                  to="/admin/tickets/$ticketId"
                  params={{ ticketId: s.ticketId }}
                  className="text-sm font-medium hover:underline truncate block"
                >
                  {s.ticket.subject ?? '(no subject)'}
                </Link>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  <TicketPriorityChip priority={s.ticket.priority as TicketPriority} />
                  <Badge variant="secondary" className="text-[10px]">
                    {SOURCE_LABEL[s.source] ?? s.source}
                  </Badge>
                  {isMuted && (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <BellSlashIcon className="h-3 w-3" />
                      muted until <TimeAgo date={s.mutedUntil!} />
                    </span>
                  )}
                  <span>·</span>
                  <span>
                    updated <TimeAgo date={s.ticket.updatedAt} />
                  </span>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
      {query.hasNextPage && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
