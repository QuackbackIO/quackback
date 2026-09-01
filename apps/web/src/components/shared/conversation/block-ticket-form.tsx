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
 * blank.
 *
 * Filed state is local to the mounted card: a successful submit collapses
 * the form to a confirmation line, and the conversation's own
 * `ticket_created` system event (delivered over the ordinary SSE flow) is
 * the durable record in the thread.
 */
import { useState } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { createMyTicketFn } from '@/lib/server/functions/tickets'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/shared/spinner'

export function BlockTicketForm({
  getAuthHeaders,
}: {
  getAuthHeaders: () => Record<string, string>
}) {
  const intl = useIntl()
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [filed, setFiled] = useState(false)

  const create = useMutation({
    mutationFn: (vars: { title: string; description?: string; email?: string }) =>
      createMyTicketFn({ data: vars, headers: getAuthHeaders() }),
    onSuccess: () => setFiled(true),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed to create ticket'),
  })

  if (filed) {
    return (
      <p className="mt-1.5 rounded-xl border border-border/60 bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
        <FormattedMessage
          id="widget.tickets.blockCard.filed"
          defaultMessage="Ticket filed — we'll track it from here."
        />
      </p>
    )
  }

  const canSubmit = title.trim().length > 0 && !create.isPending
  const submit = () => {
    if (!canSubmit) return
    create.mutate({
      title: title.trim(),
      description: details.trim() || undefined,
      email: email.trim() || undefined,
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
