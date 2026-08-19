'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { LinkIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { TicketId } from '@quackback/ids'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import { ticketQueries, ticketKeys } from '@/lib/client/queries/inbox'
import { linkTicketToTrackerFn, unlinkTicketFromTrackerFn } from '@/lib/server/functions/tickets'
import { DetailRow as Row } from '@/components/shared/detail-row'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** A short reference + title, the shape both link directions render. */
function TicketLabel({ ticket }: { ticket: Pick<TicketDTO, 'reference' | 'title'> }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {ticket.reference}
      </span>
      <span className="line-clamp-1 text-sm">{ticket.title}</span>
    </span>
  )
}

/** Pick a ticket of a given type from the recent list (bounded to 50). */
function TicketPicker({
  type,
  exclude,
  label,
  onPick,
}: {
  type: 'tracker' | 'customer'
  exclude: TicketId
  label: string
  onPick: (id: TicketId) => void
}) {
  const { data: candidates } = useQuery(ticketQueries.list({ type, limit: 50 }))
  const options = (candidates ?? []).filter((t) => t.id !== exclude)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
        >
          <PlusIcon className="size-4" /> {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
        {options.length === 0 ? (
          <div className="px-2 py-1.5 text-[13px] text-muted-foreground">No {type} tickets</div>
        ) : (
          options.map((t) => (
            <DropdownMenuItem
              key={t.id}
              onSelect={() => onPick(t.id)}
              className="flex-col items-start gap-0.5"
            >
              <TicketLabel ticket={t} />
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The Linked section of the ticket detail panel (support platform §4.9). A
 * tracker lists the customer tickets it tracks and can attach more; a customer
 * ticket shows the tracker it belongs to and can link/unlink. back_office
 * tickets have no links. Tracker status changes then cascade automatically.
 */
export function TicketLinks({ ticket, onChanged }: { ticket: TicketDTO; onChanged: () => void }) {
  const qc = useQueryClient()
  const { data } = useQuery(ticketQueries.links(ticket.id))

  const settle = () => {
    void qc.invalidateQueries({ queryKey: ticketKeys.links(ticket.id) })
    void qc.invalidateQueries({ queryKey: ticketKeys.all() })
    onChanged()
  }
  const onError = (e: unknown) =>
    toast.error(e instanceof Error ? e.message : 'Could not update the link')

  const link = useMutation({
    mutationFn: (v: { trackerTicketId: TicketId; ticketId: TicketId }) =>
      linkTicketToTrackerFn({ data: v }),
    onSuccess: settle,
    onError,
  })
  const unlink = useMutation({
    mutationFn: (v: { trackerTicketId: TicketId; ticketId: TicketId }) =>
      unlinkTicketFromTrackerFn({ data: v }),
    onSuccess: settle,
    onError,
  })

  if (ticket.type === 'tracker') {
    const linked = data?.linked ?? []
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <LinkIcon className="h-4 w-4" /> Tracking
          </span>
          <TicketPicker
            type="customer"
            exclude={ticket.id}
            label="Attach"
            onPick={(id) => link.mutate({ trackerTicketId: ticket.id, ticketId: id })}
          />
        </div>
        {linked.length === 0 ? (
          <p className="text-sm text-muted-foreground">No linked tickets</p>
        ) : (
          <ul className="space-y-0.5">
            {linked.map((t) => (
              <li
                key={t.id}
                className="group flex items-center justify-between gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50"
              >
                <TicketLabel ticket={t} />
                <button
                  type="button"
                  onClick={() => unlink.mutate({ trackerTicketId: ticket.id, ticketId: t.id })}
                  className="shrink-0 text-muted-foreground opacity-0 transition hover:text-foreground group-hover:opacity-100"
                  aria-label={`Unlink ${t.reference}`}
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // Customer / back_office: the tracker this ticket belongs to (only customer
  // tickets can be tracked, so back_office falls through to "None").
  const tracker = data?.tracker
  return (
    <Row icon={LinkIcon} label="Tracker">
      {tracker ? (
        <span className="flex min-w-0 items-center gap-1">
          <TicketLabel ticket={tracker} />
          <button
            type="button"
            onClick={() => unlink.mutate({ trackerTicketId: tracker.id, ticketId: ticket.id })}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Unlink from tracker"
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        </span>
      ) : ticket.type === 'customer' ? (
        <TicketPicker
          type="tracker"
          exclude={ticket.id}
          label="Link to tracker"
          onPick={(id) => link.mutate({ trackerTicketId: id, ticketId: ticket.id })}
        />
      ) : (
        <span className="text-sm text-muted-foreground">None</span>
      )}
    </Row>
  )
}
