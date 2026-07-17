/**
 * The portal customer ticket thread (support platform §4.2, 7C): a requester
 * reads their own ticket + replies, with the public-stage tracker up top. The
 * thread reuses the messenger VisitorMessageBubble (the requester's own messages
 * on the right, the team's on the left). Ownership + the internal-note strip are
 * enforced by the requester server fns.
 */
import { useCallback, useRef, useState } from 'react'
import { createFileRoute, Navigate, useRouteContext } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { PaperAirplaneIcon } from '@heroicons/react/24/solid'
import { BellIcon as BellIconOutline } from '@heroicons/react/24/outline'
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { JSONContent } from '@tiptap/core'
import type { TicketId } from '@quackback/ids'
import { TICKET_STAGES } from '@/lib/shared/db-types'
import type { TiptapContent } from '@/lib/shared/db-types'
import { DEFAULT_TICKET_STAGE_LABELS } from '@/lib/shared/tickets'
import {
  replyToMyTicketFn,
  watchMyTicketFn,
  unwatchMyTicketFn,
} from '@/lib/server/functions/tickets'
import { portalTicketQueries, portalTicketKeys } from '@/lib/client/queries/portal-tickets'
import { VisitorMessageBubble } from '@/components/conversation/message-bubble'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { VISITOR_CONVERSATION_FEATURES } from '@/components/conversation/conversation-editor-features'
import { usePortalImageUpload } from '@/lib/client/hooks/use-image-upload'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { Spinner } from '@/components/shared/spinner'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { BackLink } from '@/components/ui/back-link'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TicketIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'

export const Route = createFileRoute('/_portal/support/ticket/$ticketId')({
  component: PortalTicketPage,
})

/** The received -> in_progress -> awaiting_requester -> resolved progress bar,
 *  with every stage labeled under its segment (Featurebase/Intercom show the
 *  full progression, not just the current stop). Mobile keeps only the current
 *  label — four labels don't fit a phone row. */
function StageTracker({ slot }: { slot: string | null }) {
  if (!slot) return null
  const currentIndex = TICKET_STAGES.indexOf(slot as (typeof TICKET_STAGES)[number])
  return (
    <ol className="flex items-start gap-1.5" aria-label="Ticket progress">
      {TICKET_STAGES.map((stage, i) => {
        const reached = i <= currentIndex
        const current = i === currentIndex
        return (
          <li key={stage} aria-current={current ? 'step' : undefined} className="flex-1">
            <span
              className={cn(
                'block h-1.5 rounded-full transition-colors',
                reached ? (slot === 'resolved' ? 'bg-emerald-500' : 'bg-primary') : 'bg-border'
              )}
            />
            <span
              className={cn(
                'mt-1.5 block text-[11px]',
                current
                  ? 'font-semibold text-foreground'
                  : 'hidden text-muted-foreground/70 sm:block'
              )}
            >
              {DEFAULT_TICKET_STAGE_LABELS[stage]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

/** Async-thread timestamps need the day, not just a clock time — tickets span
 *  days, unlike the live messenger this bubble component was built for. */
function formatMessageTime(iso: string): string {
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

function PortalTicketPage() {
  const intl = useIntl()
  const { ticketId } = Route.useParams()
  const id = ticketId as TicketId
  const { session, settings } = useRouteContext({ from: '__root__' })
  const queryClient = useQueryClient()
  // The rich doc lives in a ref (it changes on every keystroke) so the stable
  // `handleSend` below never needs to be rebuilt — RichTextEditor rebuilds its
  // extensions whenever `onSubmit`'s identity changes. `hasContent` is the
  // reactive mirror that drives the Send button's disabled state.
  const replyJsonRef = useRef<TiptapContent | null>(null)
  const [hasContent, setHasContent] = useState(false)
  // Bumped after a successful send to remount the editor with a blank doc —
  // RichTextEditor has no imperative clear, so a key change is the reset.
  const [editorKey, setEditorKey] = useState(0)
  const { upload } = usePortalImageUpload()

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
  const { data: watchStatus } = useQuery({
    ...portalTicketQueries.watch(id),
    enabled: supportTicketsEnabled && isLoggedIn,
  })
  const watching = watchStatus?.watching ?? false

  const toggleWatch = useMutation({
    mutationFn: () =>
      watching
        ? unwatchMyTicketFn({ data: { ticketId: id } })
        : watchMyTicketFn({ data: { ticketId: id } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: portalTicketKeys.watch(id) })
    },
    onError: () => toast.error('Failed to update watch status'),
  })

  const send = useMutation({
    mutationFn: (contentJson: TiptapContent | null) =>
      // `content` stays blank: the server derives the plaintext FTS/preview
      // mirror from `contentJson` (insertTicketMessage's resolveMessageContent),
      // the same path a text-bearing doc always goes through.
      replyToMyTicketFn({ data: { ticketId: id, content: '', contentJson } }),
    onSuccess: () => {
      replyJsonRef.current = null
      setHasContent(false)
      setEditorKey((k) => k + 1)
      void queryClient.invalidateQueries({ queryKey: portalTicketKeys.thread(id) })
    },
    onError: () => toast.error('Failed to send your reply'),
  })

  const handleEditorChange = useCallback((json: JSONContent) => {
    const doc = json as TiptapContent
    replyJsonRef.current = doc
    setHasContent(!isEmptyTiptapDoc(doc))
  }, [])

  const handleSend = useCallback(() => {
    const doc = replyJsonRef.current
    if (isEmptyTiptapDoc(doc ?? undefined) || send.isPending) return
    send.mutate(doc)
  }, [send])

  if (!supportTicketsEnabled) return <Navigate to="/" />

  const messages = thread?.messages ?? []
  const canSend = hasContent && !send.isPending

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col px-4 sm:px-6 py-6">
      <BackLink to="/support" className="mb-4 self-start">
        <FormattedMessage id="portal.tickets.back" defaultMessage="All tickets" />
      </BackLink>

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
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-semibold leading-tight text-foreground">{ticket.title}</h1>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  shape="default"
                  className="shrink-0"
                  disabled={toggleWatch.isPending}
                  onClick={() => toggleWatch.mutate()}
                  aria-label={intl.formatMessage(
                    watching
                      ? { id: 'portal.tickets.watch.unwatch', defaultMessage: 'Stop watching' }
                      : { id: 'portal.tickets.watch.watch', defaultMessage: 'Watch this ticket' }
                  )}
                  aria-pressed={watching}
                >
                  {watching ? (
                    <BellIconSolid className="size-4 text-primary" />
                  ) : (
                    <BellIconOutline className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <FormattedMessage
                  id={watching ? 'portal.tickets.watch.unwatch' : 'portal.tickets.watch.watch'}
                  defaultMessage={watching ? 'Stop watching' : 'Watch this ticket'}
                />
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="mt-5">
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
                  time={formatMessageTime(m.createdAt)}
                />
              ))
            )}
          </div>

          {ticket.stage.slot === 'awaiting_requester' && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.04] px-3 py-2 text-[13px] text-amber-700 dark:text-amber-400">
              <ChatBubbleLeftRightIcon className="size-4 shrink-0" />
              <FormattedMessage
                id="portal.tickets.awaitingReply"
                defaultMessage="The team is waiting on your reply."
              />
            </div>
          )}

          <div className="mt-4 rounded-lg border border-border bg-background p-2 focus-within:ring-2 focus-within:ring-primary/20">
            <RichTextEditor
              key={editorKey}
              borderless
              minHeight="72px"
              disabled={send.isPending}
              features={VISITOR_CONVERSATION_FEATURES}
              placeholder={intl.formatMessage({
                id: 'portal.tickets.reply.placeholder',
                defaultMessage: 'Reply to the team…',
              })}
              onChange={handleEditorChange}
              onImageUpload={upload}
              onSubmit={handleSend}
            />
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={handleSend} disabled={!canSend}>
                <PaperAirplaneIcon className="me-1.5 h-4 w-4 rtl:rotate-180" />
                <FormattedMessage id="portal.tickets.reply.send" defaultMessage="Send" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
