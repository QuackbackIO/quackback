/**
 * The in-thread ticket intake form a workflow's send_ticket_form block posts
 * (block.kind 'ticketForm'). Rendered below the block's intro bubble in the
 * visitor conversation thread (widget messenger and portal thread alike —
 * both authenticate through the thread's getAuthHeaders prop, so this card
 * never reaches for a surface-specific auth context).
 *
 * Compact by design: Subject (required), Details, the customer-visible
 * fields of the intake default type (no type picker) and, only for an
 * anonymous visitor with no email on file, an Email field.
 * The type is the one the server files under when none is named (the intake
 * default, else the first intake type), and the form sends its id with the
 * answers, so a required field is filled here and passes the server's check.
 * With no intake types (an empty list) only the three plain inputs show. While
 * the type list loads, the fields area shows a spinner; if the read still
 * fails after its retries, the fields area shows the error and a Try again
 * button, and the form cannot be sent, since the server would refuse a
 * submit that skips a required field. An identified visitor, or an anonymous
 * one whose email is already on file, is never asked for it: the ticket links
 * to their session principal (`askEmail` false, from the thread load).
 * With `askDueDate` (the node's toggle) the card also offers an optional
 * "Needed by" day, sent as the end of that day in the visitor's own time
 * zone; the team may adjust it later.
 *
 * Filed state is local to the mounted card: a successful submit collapses
 * the form to a confirmation line, and the conversation's own
 * `ticket_created` system event (delivered over the ordinary SSE flow) is
 * the durable record in the thread.
 */
import { useEffect, useId, useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useVisitorSurfaceRpc } from '@/lib/client/visitor-surface-rpc'
import { ticketIntakeFormQuery } from '@/lib/client/queries/visitor-ticket-form'
import { errorText } from '@/lib/client/error-text'
import type { TicketIntakeType } from '@/lib/shared/tickets'
import {
  endOfLocalDay,
  ticketDueBounds,
  ticketDueProblem,
  toLocalDateInputValue,
} from '@/lib/shared/ticket-due'
import { TicketFormFields } from '@/components/shared/ticket-form-fields'
import { useTicketIntakeForm } from '@/components/shared/use-ticket-intake-form'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/shared/spinner'
import { toastError } from '@/lib/client/error-notice'
import { BlockTicketFormLoadingRow } from './block-ticket-form-loading'

const NO_TYPES: TicketIntakeType[] = []

/** The type the server files under when the create names none: the intake
 *  default, else the first intake type (resolveIntakeCreate). */
function intakeDefaultType(types: TicketIntakeType[]): TicketIntakeType | null {
  return types.find((t) => t.isDefault) ?? types[0] ?? null
}

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
  askEmail = true,
  askDueDate = false,
}: {
  getAuthHeaders: () => Record<string, string>
  /** Show the Email field: only an anonymous visitor with no email on file. */
  askEmail?: boolean
  /** Offer the optional "Needed by" date field (the node's askDueDate toggle). */
  askDueDate?: boolean
}) {
  const intl = useIntl()
  const rpc = useVisitorSurfaceRpc()
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [neededByInvalid, setNeededByInvalid] = useState(false)
  const [filed, setFiled] = useState(false)
  const id = useId()
  // The window depends on the viewer's clock and zone, so it is set after
  // mount: bounds in the server's markup would not match the hydrating render.
  const [dueBounds, setDueBounds] = useState<{ min: string; max: string } | null>(null)
  useEffect(() => {
    if (askDueDate) setDueBounds(customerDueInputBounds())
  }, [askDueDate])

  // Shares the ticket header card's cache entry. Only a successful empty list
  // means no intake types.
  const intakeForm = useQuery(ticketIntakeFormQuery(rpc, getAuthHeaders))
  const types = intakeForm.data?.types ?? NO_TYPES
  const intake = useTicketIntakeForm(types, { resolveSelectedType: intakeDefaultType })

  const create = useMutation({
    mutationFn: (vars: {
      title: string
      description?: string
      email?: string
      ticketTypeId?: string
      fieldValues?: Record<string, unknown>
      dueAt?: string
    }) => rpc.createMyTicket({ data: vars, headers: getAuthHeaders() }),
    onSuccess: () => setFiled(true),
    onError: (error) => toastError(error, 'Failed to create ticket'),
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

  // Only once the type list is in, so a required field is on screen first.
  const canSubmit = title.trim().length > 0 && !create.isPending && intakeForm.isSuccess
  const submit = () => {
    if (!canSubmit) return
    const type = intake.selectedType
    let fieldValues: Record<string, unknown> | undefined
    if (type) {
      const checked = intake.validate()
      if (!checked.ok) return
      fieldValues = checked.values
    }
    // A picked day means the end of that day where the visitor is.
    const dueAt = askDueDate && neededBy ? endOfLocalDay(neededBy) : null
    if (askDueDate && neededBy && ticketDueProblem(dueAt, 'customer')) {
      setNeededByInvalid(true)
      return
    }
    create.mutate({
      title: title.trim(),
      description: details.trim() || undefined,
      email: (askEmail && email.trim()) || undefined,
      ...(type ? { ticketTypeId: type.id, fieldValues } : {}),
      // Only when a day was picked, so the payload is unchanged otherwise.
      ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
    })
  }

  return (
    <div className="mt-1.5 w-full max-w-sm space-y-2 rounded-xl border border-border bg-background p-3 shadow-xs">
      <div className="space-y-1">
        <label htmlFor={`${id}-subject`} className="text-xs font-medium text-muted-foreground">
          <FormattedMessage id="widget.tickets.new.subject" defaultMessage="Subject" />
          <span aria-hidden className="ms-0.5 text-destructive">
            *
          </span>
        </label>
        <Input
          id={`${id}-subject`}
          aria-required
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
        <label htmlFor={`${id}-details`} className="text-xs font-medium text-muted-foreground">
          <FormattedMessage id="widget.tickets.new.details" defaultMessage="Details" />
        </label>
        <textarea
          id={`${id}-details`}
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
      {intakeForm.isPending && <BlockTicketFormLoadingRow />}
      {intakeForm.isError && (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
        >
          <span>
            {errorText(
              intakeForm.error,
              intl.formatMessage({
                id: 'widget.tickets.blockCard.formLoadFailed',
                defaultMessage: "Couldn't load this form.",
              })
            )}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void intakeForm.refetch()}
            disabled={intakeForm.isFetching}
          >
            <FormattedMessage id="widget.tickets.blockCard.retry" defaultMessage="Try again" />
          </Button>
        </div>
      )}
      <TicketFormFields
        fields={intake.fields}
        values={intake.fieldValues}
        onChange={intake.setFieldValue}
        errors={intake.fieldErrors}
      />
      {askDueDate && (
        <div className="space-y-1">
          <label htmlFor={`${id}-due`} className="text-xs font-medium text-muted-foreground">
            <FormattedMessage id="widget.tickets.new.neededBy" defaultMessage="Needed by" />
            <span className="ms-1 font-normal text-muted-foreground/70">
              <FormattedMessage id="widget.tickets.new.optional" defaultMessage="(optional)" />
            </span>
          </label>
          <Input
            id={`${id}-due`}
            type="date"
            value={neededBy}
            min={dueBounds?.min}
            max={dueBounds?.max}
            onChange={(e) => {
              setNeededBy(e.target.value)
              setNeededByInvalid(false)
            }}
            aria-invalid={neededByInvalid}
            aria-describedby={neededByInvalid ? `${id}-due-hint ${id}-due-error` : `${id}-due-hint`}
          />
          <p id={`${id}-due-hint`} className="text-[11px] text-muted-foreground/70">
            <FormattedMessage
              id="widget.tickets.new.neededByHint"
              defaultMessage="Our team may adjust this date."
            />
          </p>
          {neededByInvalid && (
            <p id={`${id}-due-error`} className="text-[11px] text-destructive">
              <FormattedMessage
                id="widget.tickets.new.neededByInvalid"
                defaultMessage="Pick a date between today and two years from now."
              />
            </p>
          )}
        </div>
      )}
      {askEmail && (
        <div className="space-y-1">
          <label htmlFor={`${id}-email`} className="text-xs font-medium text-muted-foreground">
            <FormattedMessage id="widget.tickets.new.email" defaultMessage="Email" />
          </label>
          <Input
            id={`${id}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={intl.formatMessage({
              id: 'widget.tickets.new.emailPlaceholder',
              defaultMessage: 'you@example.com',
            })}
          />
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
