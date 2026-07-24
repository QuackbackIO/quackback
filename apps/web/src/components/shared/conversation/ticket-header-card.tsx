/**
 * The converged Messages surface's ticket header (design: one thread per pair,
 * rendered as a conversation with a ticket "hat"): compact stage chip + title +
 * reference + watch bell on top, the full StageTracker under it, and a
 * collapsed Details disclosure holding what the old ticket page's rail showed
 * (type, opened date, intake answers). Rendered by VisitorConversationThread
 * whenever the conversation carries a linked customer ticket — one
 * implementation for the portal and the widget, like the thread itself.
 *
 * Stage changes are told twice by design: the in-thread system event narrates
 * the crossing, this header shows the current truth.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { ChevronRightIcon, BellIcon as BellIconOutline } from '@heroicons/react/24/outline'
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid'
import type { TicketId } from '@quackback/ids'
import type { RequesterTicketDTO } from '@/lib/server/domains/tickets'
import type { TicketFormField } from '@/lib/shared/tickets'
import { DEFAULT_TICKET_STAGE_LABELS } from '@/lib/shared/tickets'
import { readAttributeValue } from '@/lib/shared/conversation/attribute-values'
import { StageChip, StageTracker } from '@/components/shared/ticket-stage'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'
import {
  getMyTicketStageLabelsFn,
  getMyTicketFormFn,
  getMyTicketWatchStatusFn,
  watchMyTicketFn,
  unwatchMyTicketFn,
} from '@/lib/server/functions/tickets'

const NO_HEADERS = (): Record<string, string> => ({})

/** Render one stored intake answer as customer-facing text, keyed off the
 *  field's declared type (checkbox → Yes/No, date → localized day, lists →
 *  comma-joined). Null for an empty/unset answer so the row is skipped. */
function formatIntakeValue(
  field: TicketFormField,
  value: unknown,
  intl: ReturnType<typeof useIntl>
): string | null {
  const read = readAttributeValue(value)
  if (!read) return null
  const v = read.v
  if (v === null || v === undefined || v === '') return null
  if (Array.isArray(v)) {
    const joined = v.filter((x) => x !== null && x !== '').join(', ')
    return joined || null
  }
  if (field.type === 'checkbox') {
    return v
      ? intl.formatMessage({ id: 'portal.tickets.details.yes', defaultMessage: 'Yes' })
      : intl.formatMessage({ id: 'portal.tickets.details.no', defaultMessage: 'No' })
  }
  if (field.type === 'date' && typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime())
      ? v
      : d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
  }
  return String(v)
}

export function TicketHeaderCard({
  ticket,
  getAuthHeaders = NO_HEADERS,
}: {
  ticket: RequesterTicketDTO
  /** Widget passes its Bearer-token headers; portal rides on cookies. */
  getAuthHeaders?: () => Record<string, string>
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const id = ticket.id as TicketId

  // B19: customized stage labels, shared cache with everything ticket-shaped.
  const { data: stageLabels } = useQuery({
    queryKey: ['ticket-stage-labels'],
    queryFn: () => getMyTicketStageLabelsFn({ headers: getAuthHeaders() }),
    staleTime: 300_000,
  })
  // The intake form resolves stored answers back to field labels; only
  // fetched once the Details disclosure is opened.
  const { data: intakeForm } = useQuery({
    queryKey: ['ticket-intake-form'],
    queryFn: () => getMyTicketFormFn({ headers: getAuthHeaders() }),
    staleTime: 300_000,
    enabled: expanded && !!ticket.ticketType,
  })
  const { data: watchStatus } = useQuery({
    queryKey: ['ticket-watch', id],
    queryFn: () => getMyTicketWatchStatusFn({ data: { ticketId: id }, headers: getAuthHeaders() }),
    staleTime: 30_000,
  })
  const watching = watchStatus?.watching ?? false

  const toggleWatch = useMutation({
    mutationFn: () =>
      watching
        ? unwatchMyTicketFn({ data: { ticketId: id }, headers: getAuthHeaders() })
        : watchMyTicketFn({ data: { ticketId: id }, headers: getAuthHeaders() }),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['ticket-watch', id] }),
  })

  const intakeType = ticket.ticketType
    ? intakeForm?.types.find((t) => t.id === ticket.ticketType?.id)
    : undefined
  const answers = (intakeType?.fields ?? [])
    .map((field) => ({
      field,
      text: formatIntakeValue(field, ticket.customAttributes[field.key], intl),
    }))
    .filter((a): a is { field: TicketFormField; text: string } => a.text !== null)

  return (
    <div className="shrink-0 border-b border-border/40 bg-muted/20 px-3 pb-2.5 pt-2">
      <div className="flex items-center gap-2">
        <StageChip
          slot={ticket.stage.slot}
          label={
            ticket.stage.slot
              ? (stageLabels ?? DEFAULT_TICKET_STAGE_LABELS)[ticket.stage.slot]
              : null
          }
          closed={ticket.stage.closed}
          closedLabelId="portal.tickets.stage.closed"
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {ticket.title}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
          {ticket.reference}
        </span>
        <button
          type="button"
          disabled={toggleWatch.isPending}
          onClick={() => toggleWatch.mutate()}
          aria-pressed={watching}
          aria-label={intl.formatMessage(
            watching
              ? { id: 'portal.tickets.watch.unwatch', defaultMessage: 'Stop watching' }
              : { id: 'portal.tickets.watch.watch', defaultMessage: 'Watch this ticket' }
          )}
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {watching ? (
            <BellIconSolid className="size-4 text-primary" />
          ) : (
            <BellIconOutline className="size-4" />
          )}
        </button>
      </div>

      <div className="mt-2.5">
        <StageTracker
          slot={ticket.stage.slot}
          closed={ticket.stage.closed}
          labels={stageLabels ?? DEFAULT_TICKET_STAGE_LABELS}
          closedLabelId="portal.tickets.stage.closed"
        />
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronRightIcon
          className={cn(
            'size-3.5 transition-transform rtl:rotate-180',
            expanded && 'rotate-90 rtl:rotate-90'
          )}
        />
        <FormattedMessage id="tickets.header.details" defaultMessage="Details" />
        {ticket.ticketType && (
          <span className="text-muted-foreground/60">· {ticket.ticketType.name}</span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 rounded-md border border-border/40 bg-background/60 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              <FormattedMessage id="portal.tickets.details.opened" defaultMessage="Opened" />
            </span>
            <TimeAgo date={new Date(ticket.createdAt)} className="font-medium text-foreground" />
          </div>
          {answers.map(({ field, text }) => (
            <div key={field.key} className="text-xs">
              <p className="text-muted-foreground">{field.label}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-foreground">{text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
