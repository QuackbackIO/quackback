/**
 * Right-panel "SLA" tab. Read-only summary of the ticket's active SLA clocks,
 * each rendered with `<SlaClockChip />`. Policy management lives in admin
 * settings; we only display state here.
 */
import { useSuspenseQuery } from '@tanstack/react-query'
import type { TicketId } from '@quackback/ids'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { SlaClockChip, type SlaClockKind, type SlaClockState } from './sla-clock-chip'

export interface TicketSlaPanelProps {
  ticketId: TicketId
}

const KIND_LABELS: Record<string, string> = {
  first_response: 'First response',
  next_response: 'Next response',
  resolution: 'Resolution',
}

export function TicketSlaPanel({ ticketId }: TicketSlaPanelProps) {
  const { data } = useSuspenseQuery(ticketQueries.slaClocks(ticketId))

  if (data.length === 0) {
    return <div className="text-xs text-muted-foreground py-2">No SLA clocks on this ticket.</div>
  }

  return (
    <div className="space-y-2 text-sm">
      {data.map((clock) => (
        <div
          key={clock.id}
          className="flex items-center justify-between rounded border border-border/50 px-2 py-1.5"
        >
          <span className="text-xs font-medium">{KIND_LABELS[clock.kind] ?? clock.kind}</span>
          <SlaClockChip
            clock={{
              kind: clock.kind as SlaClockKind,
              state: clock.state as SlaClockState,
              dueAt: clock.dueAt,
              breachedAt: clock.breachedAt,
              metAt: clock.metAt,
            }}
          />
        </div>
      ))}
    </div>
  )
}
