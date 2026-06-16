import { createFileRoute, redirect, notFound, Link } from '@tanstack/react-router'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { FormattedMessage } from 'react-intl'
import type { JSONContent } from '@tiptap/react'
import { isValidTypeId, type TicketId } from '@quackback/ids'
import { portalTicketQueries } from '@/lib/client/queries/portal-tickets'
import {
  updateMyTicketDescriptionFn,
  closeMyTicketFn,
  reopenMyTicketFn,
} from '@/lib/server/functions/portal-tickets'
import { Button } from '@/components/ui/button'
import { PortalTicketDetailHeader } from '@/components/public/tickets/portal-ticket-detail-header'
import { PortalTicketThreadFeed } from '@/components/public/tickets/portal-ticket-thread-feed'
import { PortalTicketReplyComposer } from '@/components/public/tickets/portal-ticket-reply-composer'
import { toast } from 'sonner'

export const Route = createFileRoute('/_portal/tickets/$ticketId')({
  parseParams: ({ ticketId }) => {
    if (!isValidTypeId(ticketId, 'ticket')) throw notFound()
    return { ticketId: ticketId as TicketId }
  },
  loader: async ({ context, params }) => {
    if (!context.session?.user) {
      throw redirect({
        to: '/auth/login',
        search: { next: `/tickets/${params.ticketId}` } as never,
      })
    }
    try {
      await context.queryClient.ensureQueryData(portalTicketQueries.detail(params.ticketId))
    } catch (err) {
      // Domain layer throws NotFoundError for tickets the user doesn't own;
      // surface as a 404 rather than an error page.
      const code = (err as { code?: string })?.code
      if (code === 'TICKET_NOT_FOUND') throw notFound()
      throw err
    }
    return { workspaceName: context.settings?.name ?? '' }
  },
  head: ({ loaderData }) => {
    const title = loaderData?.workspaceName ? `Ticket · ${loaderData.workspaceName}` : 'Ticket'
    return { meta: [{ title }] }
  },
  component: TicketDetailPage,
})

function TicketDetailPage() {
  const { ticketId } = Route.useParams()
  const { data } = useSuspenseQuery(portalTicketQueries.detail(ticketId))
  const isClosed = data.ticket.statusCategory === 'closed'
  const isSolved = data.ticket.statusCategory === 'solved'
  const isActive = !isClosed && !isSolved
  const relationship = data.viewerRelationship
  const isRequester = relationship === 'requester'
  const canReply = relationship === 'requester' || relationship === 'collaborator'
  const qc = useQueryClient()

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: portalTicketQueries.detail(ticketId).queryKey })

  const latestExpectedUpdatedAt = useCallback(() => {
    const latest = qc.getQueryData<typeof data>(portalTicketQueries.detail(ticketId).queryKey)
    return latest?.ticket.updatedAt ?? data.ticket.updatedAt
  }, [data, qc, ticketId])

  const closeMutation = useMutation({
    mutationFn: () => closeMyTicketFn({ data: { ticketId } }),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['portal', 'tickets', 'list'] })
      toast.success('Ticket marked as solved')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const reopenMutation = useMutation({
    mutationFn: () => reopenMyTicketFn({ data: { ticketId } }),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['portal', 'tickets', 'list'] })
      toast.success('Ticket reopened')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const descriptionMutation = useMutation({
    mutationFn: (patch: { descriptionJson: JSONContent | null; descriptionText: string | null }) =>
      updateMyTicketDescriptionFn({
        data: {
          ticketId,
          expectedUpdatedAt: latestExpectedUpdatedAt(),
          descriptionJson: patch.descriptionJson as { type: 'doc'; content?: unknown[] } | null,
          descriptionText: patch.descriptionText,
        },
      }),
    onSuccess: (updated) => {
      qc.setQueryData<typeof data>(portalTicketQueries.detail(ticketId).queryKey, (current) =>
        current
          ? { ...current, ticket: { ...current.ticket, updatedAt: updated.updatedAt } }
          : current
      )
      qc.invalidateQueries({ queryKey: portalTicketQueries.detail(ticketId).queryKey })
      toast.success('Description updated')
    },
    onError: (e: Error) => {
      if (/conflict|stale/i.test(e.message)) {
        toast.error('Ticket changed — please refresh')
      } else {
        toast.error(e.message)
      }
    },
  })

  const handleDescriptionUpdate = useCallback(
    (json: JSONContent | null, text: string | null) => {
      descriptionMutation.mutate({ descriptionJson: json, descriptionText: text })
    },
    [descriptionMutation]
  )

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <Link
        to="/tickets"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        <FormattedMessage id="portal.tickets.detail.back" defaultMessage="My tickets" />
      </Link>

      <PortalTicketDetailHeader
        subject={data.ticket.subject}
        statusName={data.ticket.statusName}
        statusCategory={data.ticket.statusCategory}
        createdAt={data.ticket.createdAt}
        lastActivityAt={data.ticket.lastActivityAt}
      />

      {isRequester && isActive && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => closeMutation.mutate()}
            disabled={closeMutation.isPending}
          >
            <FormattedMessage id="portal.tickets.action.solve" defaultMessage="Mark as solved" />
          </Button>
        </div>
      )}

      {isRequester && isSolved && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reopenMutation.mutate()}
            disabled={reopenMutation.isPending}
          >
            <FormattedMessage id="portal.tickets.action.reopen" defaultMessage="Reopen" />
          </Button>
        </div>
      )}

      <PortalTicketThreadFeed
        threads={data.threads}
        principalNames={data.principalNames}
        viewerPrincipalId={data.viewerPrincipalId}
        description={
          data.ticket.descriptionText || data.ticket.descriptionJson
            ? { text: data.ticket.descriptionText, json: data.ticket.descriptionJson }
            : null
        }
        onDescriptionUpdate={isRequester && !isClosed ? handleDescriptionUpdate : undefined}
        isDescriptionSaving={descriptionMutation.isPending}
      />

      {canReply ? (
        <PortalTicketReplyComposer ticketId={ticketId} isClosed={isClosed} />
      ) : (
        <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
          <FormattedMessage
            id="portal.tickets.composer.watching"
            defaultMessage="You are watching this ticket. Only requesters and collaborators can reply."
          />
        </div>
      )}
    </div>
  )
}
