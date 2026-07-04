/**
 * Portal "New Ticket" form (support platform §4.2, 7C): the basic fixed form
 * (title + description) a requester uses to open their own customer ticket. On
 * success it navigates to the new ticket's thread.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { toast } from 'sonner'
import { createMyTicketFn } from '@/lib/server/functions/tickets'
import { portalTicketKeys } from '@/lib/client/queries/portal-tickets'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

export function NewPortalTicketDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const intl = useIntl()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  useEffect(() => {
    if (open) {
      setTitle('')
      setDescription('')
    }
  }, [open])

  const create = useMutation({
    mutationFn: (vars: { title: string; description?: string }) => createMyTicketFn({ data: vars }),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: portalTicketKeys.list() })
      onOpenChange(false)
      void navigate({ to: '/support/ticket/$ticketId', params: { ticketId: ticket.id } })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Failed to create ticket'),
  })

  const canSubmit = title.trim().length > 0 && !create.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage id="portal.tickets.new.title" defaultMessage="New ticket" />
          </DialogTitle>
          <DialogDescription>
            <FormattedMessage
              id="portal.tickets.new.subtitle"
              defaultMessage="Tell us what you need and we'll track it to resolution."
            />
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              <FormattedMessage id="portal.tickets.new.subject" defaultMessage="Subject" />
            </label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              placeholder={intl.formatMessage({
                id: 'portal.tickets.new.subjectPlaceholder',
                defaultMessage: 'Summarize your request…',
              })}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              <FormattedMessage id="portal.tickets.new.details" defaultMessage="Details" />
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={4000}
              rows={5}
              placeholder={intl.formatMessage({
                id: 'portal.tickets.new.detailsPlaceholder',
                defaultMessage: 'Add anything that helps us understand the issue.',
              })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </Button>
          <Button
            onClick={() =>
              create.mutate({ title: title.trim(), description: description.trim() || undefined })
            }
            disabled={!canSubmit}
          >
            <FormattedMessage id="portal.tickets.new.submit" defaultMessage="Create ticket" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
