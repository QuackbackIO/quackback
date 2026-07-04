/**
 * The portal customer ticket thread (support platform §4.2, 7C): a requester
 * reads their own ticket + replies, with the public-stage tracker up top. The
 * thread reuses the messenger VisitorMessageBubble (the requester's own messages
 * on the right, the team's on the left). Ownership + the internal-note strip are
 * enforced by the requester server fns.
 */
import { useState } from 'react'
import { createFileRoute, Link, Navigate, useRouteContext } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { ArrowLeftIcon, PaperAirplaneIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { TicketId } from '@quackback/ids'
import { TICKET_STAGES } from '@/lib/shared/db-types'
import { DEFAULT_TICKET_STAGE_LABELS } from '@/lib/shared/tickets'
import { replyToMyTicketFn } from '@/lib/server/functions/tickets'
import { portalTicketQueries, portalTicketKeys } from '@/lib/client/queries/portal-tickets'
import { VisitorMessageBubble } from '@/components/conversation/message-bubble'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { TicketIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'

export const Route = createFileRoute('/_portal/support/ticket/$ticketId')({
  component: PortalTicketPage,
})

/** The received -> in_progress -> awaiting_requester -> resolved progress bar. */
function StageTracker({ slot }: { slot: string | null }) {
  if (!slot) return null
  const currentIndex = TICKET_STAGES.indexOf(slot as (typeof TICKET_STAGES)[number])
  return (
    <ol className="flex items-center gap-1.5" aria-label="Ticket progress">
      {TICKET_STAGES.map((stage, i) => {
        const reached = i <= currentIndex
        return (
          <li key={stage} className="flex flex-1 items-center gap-1.5">
            <span
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                reached ? (slot === 'resolved' ? 'bg-emerald-500' : 'bg-primary') : 'bg-border'
              )}
            />
            {i === currentIndex && (
              <span className="shrink-0 text-[11px] font-medium text-foreground">
                {DEFAULT_TICKET_STAGE_LABELS[stage]}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function PortalTicketPage() {
  const intl = useIntl()
  const { ticketId } = Route.useParams()
  const id = ticketId as TicketId
  const { session, settings } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  const [reply, setReply] = useState('')

  const supportTicketsEnabled = !!settings?.featureFlags?.supportTickets
  const isLoggedIn = !!session?.user && session.user.principalType !== 'anonymous'

  const {
    data: ticket,
    isLoading,
    isError,
  } = useQuery({
    ...portalTicketQueries.detail(id),
    enabled: supportTicketsEnabled && isLoggedIn,
  })
  const { data: thread } = useQuery({
    ...portalTicketQueries.thread(id),
    enabled: supportTicketsEnabled && isLoggedIn,
  })

  const send = useMutation({
    mutationFn: (content: string) => replyToMyTicketFn({ data: { ticketId: id, content } }),
    onSuccess: () => {
      setReply('')
      void queryClient.invalidateQueries({ queryKey: portalTicketKeys.thread(id) })
    },
    onError: () => toast.error('Failed to send your reply'),
  })

  if (!supportTicketsEnabled) return <Navigate to="/" />

  const messages = thread?.messages ?? []
  const canSend = reply.trim().length > 0 && !send.isPending

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 sm:px-6 py-6">
      <Link
        to="/support"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4 rtl:rotate-180" />
        <FormattedMessage id="portal.tickets.back" defaultMessage="All tickets" />
      </Link>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : isError || !ticket ? (
        <EmptyState
          icon={TicketIcon}
          title={intl.formatMessage({
            id: 'portal.tickets.notFound.title',
            defaultMessage: 'Ticket not found',
          })}
          description={intl.formatMessage({
            id: 'portal.tickets.notFound.body',
            defaultMessage: 'It may have been removed, or you no longer have access.',
          })}
        />
      ) : (
        <>
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground/70">{ticket.reference}</span>
          </div>
          <h1 className="text-lg font-semibold leading-tight text-foreground">{ticket.title}</h1>
          <div className="mt-4">
            <StageTracker slot={ticket.stage.slot} />
          </div>

          <div className="mt-6 flex flex-col gap-3">
            {messages.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                <FormattedMessage
                  id="portal.tickets.thread.empty"
                  defaultMessage="No replies yet."
                />
              </p>
            ) : (
              messages.map((m) => (
                <VisitorMessageBubble
                  key={m.id}
                  content={m.content}
                  contentJson={m.contentJson}
                  side={m.senderType === 'visitor' ? 'self' : 'peer'}
                  authorName={m.author?.displayName ?? undefined}
                  isAssistant={m.isAssistant}
                  attachments={m.attachments}
                  citations={m.citations}
                  time={m.createdAt}
                />
              ))
            )}
          </div>

          <div className="mt-4 rounded-lg border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-primary/20">
            <Textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder={intl.formatMessage({
                id: 'portal.tickets.reply.placeholder',
                defaultMessage: 'Reply to the team…',
              })}
              className="border-0 focus-visible:ring-0"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (canSend) send.mutate(reply.trim())
                }
              }}
            />
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => canSend && send.mutate(reply.trim())}
                disabled={!canSend}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40 transition-opacity"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
                <FormattedMessage id="portal.tickets.reply.send" defaultMessage="Send" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
