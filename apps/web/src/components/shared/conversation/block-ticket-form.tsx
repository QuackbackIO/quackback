/**
 * The in-thread ticket intake form a workflow's send_ticket_form block posts
 * (block.kind 'ticketForm'). Rendered below the block's intro bubble in the
 * visitor conversation thread (widget messenger and portal thread alike —
 * both authenticate through the thread's getAuthHeaders prop, so this card
 * never reaches for a surface-specific auth context).
 *
 * Compact by design: Subject (required), Details, and an Email field — the
 * same payload shape createMyTicketFn accepts, minus the type picker and
 * custom intake fields. The email is optional here: an identified visitor's
 * ticket links to their session principal, and an anonymous one can leave it
 * blank. With `askDueDate` (the node's toggle) the card also offers an
 * optional "Needed by" day, sent as the end of that day in the visitor's own
 * time zone; the team may adjust it later.
 *
 * Filed state is local to the mounted card: a successful submit collapses
 * the form to a confirmation line, and the conversation's own
 * `ticket_created` system event (delivered over the ordinary SSE flow) is
 * the durable record in the thread.
 */
import { useEffect, useId, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useVisitorSurfaceRpc } from '@/lib/client/visitor-surface-rpc'
import {
  endOfLocalDay,
  ticketDueBounds,
  ticketDueProblem,
  toLocalDateInputValue,
} from '@/lib/shared/ticket-due'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/shared/spinner'

/**
 * The picker's `min`/`max` (YYYY-MM-DD) for the customer window, in the
 * viewer's zone. The last day is dropped when its end would pass the window,
 * so the picker never offers a day the check below rejects.
 */
function customerDueInputBounds(now: Date = new Date()): { min: string; max: string } {
  const { min, max } = ticketDueBounds('customer', now)
  let maxDay = toLocalDateInputValue(max)
  const maxDayEnd = endOfLocalDay(maxDay)
  if (maxDayEnd && maxDayEnd.getTime() > max.getTime()) {
    const previous = new Date(max)
    previous.setDate(previous.getDate() - 1)
    maxDay = toLocalDateInputValue(previous)
  }
  return { min: toLocalDateInputValue(min), max: maxDay }
}

export function BlockTicketForm({
  getAuthHeaders,
  askDueDate = false,
}: {
  getAuthHeaders: () => Record<string, string>
  /** Offer the optional "Needed by" date field (the node's askDueDate toggle). */
  askDueDate?: boolean
}) {
  const intl = useIntl()
  const rpc = useVisitorSurfaceRpc()
  const dueInputId = useId()
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [neededByInvalid, setNeededByInvalid] = useState(false)
  const [filed, setFiled] = useState(false)
  // The window depends on the viewer's clock and zone, so it is set after
  // mount: bounds in the server's markup would not match the hydrating render.
  const [dueBounds, setDueBounds] = useState<{ min: string; max: string } | null>(null)
  useEffect(() => {
    if (askDueDate) setDueBounds(customerDueInputBounds())
  }, [askDueDate])

  const create = useMutation({
    mutationFn: (vars: { title: string; description?: string; email?: string; dueAt?: string }) =>
      rpc.createMyTicket({ data: vars, headers: getAuthHeaders() }),
    onSuccess: () => setFiled(true),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed to create ticket'),
  })

  if (filed) {
    return (
      <p className="mt-1.5 rounded-xl border border-border/60 bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
        <FormattedMessage
          id="widget.tickets.blockCard.filed"
          defaultMessage="Ticket filed. We'll track it from here."
        />
      </p>
    )
  }

  const canSubmit = title.trim().length > 0 && !create.isPending
  const submit = () => {
    if (!canSubmit) return
    // A picked day means the end of that day where the visitor is.
    const dueAt = askDueDate && neededBy ? endOfLocalDay(neededBy) : null
    if (askDueDate && neededBy && ticketDueProblem(dueAt, 'customer')) {
      setNeededByInvalid(true)
      return
    }
    create.mutate({
      title: title.trim(),
      description: details.trim() || undefined,
      email: email.trim() || undefined,
      // Only when a day was picked, so the payload is unchanged otherwise.
      ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
    })
  }

  return (
    <div className="mt-1.5 w-full max-w-sm space-y-2 rounded-xl border border-border bg-background p-3 shadow-xs">
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          <FormattedMessage id="widget.tickets.new.subject" defaultMessage="Subject" />
          <span className="ms-0.5 text-destructive">*</span>
        </label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
          placeholder={intl.formatMessage({
            id: 'widget.tickets.new.subjectPlaceholder',
            defaultMessage: 'Summarize your request…',
          })}
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          <FormattedMessage id="widget.tickets.new.details" defaultMessage="Details" />
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          rows={3}
          placeholder={intl.formatMessage({
            id: 'widget.tickets.new.detailsPlaceholder',
            defaultMessage: 'Add anything that helps us understand the issue.',
          })}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">
          <FormattedMessage id="widget.tickets.new.email" defaultMessage="Email" />
        </label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={intl.formatMessage({
            id: 'widget.tickets.new.emailPlaceholder',
            defaultMessage: 'you@example.com',
          })}
        />
      </div>
      {askDueDate && (
        <div className="space-y-1">
          <label htmlFor={dueInputId} className="text-xs font-medium text-muted-foreground">
            <FormattedMessage id="widget.tickets.new.neededBy" defaultMessage="Needed by" />
            <span className="ms-1 font-normal text-muted-foreground/70">
              <FormattedMessage id="widget.tickets.new.optional" defaultMessage="(optional)" />
            </span>
          </label>
          <Input
            id={dueInputId}
            type="date"
            value={neededBy}
            min={dueBounds?.min}
            max={dueBounds?.max}
            onChange={(e) => {
              setNeededBy(e.target.value)
              setNeededByInvalid(false)
            }}
            aria-invalid={neededByInvalid}
            aria-describedby={
              neededByInvalid ? `${dueInputId}-hint ${dueInputId}-error` : `${dueInputId}-hint`
            }
          />
          <p id={`${dueInputId}-hint`} className="text-[11px] text-muted-foreground/70">
            <FormattedMessage
              id="widget.tickets.new.neededByHint"
              defaultMessage="Our team may adjust this date."
            />
          </p>
          {neededByInvalid && (
            <p id={`${dueInputId}-error`} className="text-[11px] text-destructive">
              <FormattedMessage
                id="widget.tickets.new.neededByInvalid"
                defaultMessage="Pick a date between today and two years from now."
              />
            </p>
          )}
        </div>
      )}
      <Button className="w-full" size="sm" onClick={submit} disabled={!canSubmit}>
        {create.isPending ? (
          <Spinner />
        ) : (
          <FormattedMessage id="widget.tickets.new.submit" defaultMessage="Create ticket" />
        )}
      </Button>
    </div>
  )
}
