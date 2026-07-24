/**
 * The portal customer ticket thread (support platform §4.2, 7C): a requester
 * reads their own ticket + replies, with the public-stage tracker up top. The
 * thread reuses the messenger VisitorMessageBubble (the requester's own messages
 * on the right, the team's on the left). Ownership + the internal-note strip are
 * enforced by the requester server fns.
 */
import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { createFileRoute, Navigate, useRouteContext } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { PaperAirplaneIcon } from '@heroicons/react/24/solid'
import {
  BellIcon as BellIconOutline,
  HashtagIcon,
  Squares2X2Icon,
  CalendarIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { JSONContent } from '@tiptap/core'
import type { TicketId } from '@quackback/ids'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { RequesterTicketDTO } from '@/lib/server/domains/tickets'
import type { TicketFormField, TicketIntakeType, TicketStageLabels } from '@/lib/shared/tickets'
import { DEFAULT_TICKET_STAGE_LABELS } from '@/lib/shared/tickets'
import { readAttributeValue } from '@/lib/shared/conversation/attribute-values'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'
import {
  replyToMyTicketFn,
  watchMyTicketFn,
  unwatchMyTicketFn,
  markMyTicketReadFn,
} from '@/lib/server/functions/tickets'
import { portalTicketQueries, portalTicketKeys } from '@/lib/client/queries/portal-tickets'
import { PORTAL_MY_CONVERSATIONS_QUERY_KEY } from '@/lib/client/queries/portal-support'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { VisitorMessageBubble } from '@/components/conversation/message-bubble'
import { SystemEventNotice } from '@/components/shared/conversation/system-event-notice'
import { StageTracker } from '@/components/shared/ticket-stage'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { VISITOR_CONVERSATION_FEATURES } from '@/components/conversation/conversation-editor-features'
import { usePortalImageUpload } from '@/lib/client/hooks/use-image-upload'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { BackLink } from '@/components/ui/back-link'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TicketIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'

export const Route = createFileRoute('/_portal/support/ticket/$ticketId')({
  component: PortalTicketPage,
})

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

/** One skeleton message row — mirrors VisitorMessageBubble's geometry
 *  (`max-w-[85%]` bubble, right-aligned for the requester's own messages,
 *  left-aligned for the team's) so the thread doesn't reflow when the real
 *  messages replace it. `bubbleWidth` varies per row so the thread doesn't
 *  read as a uniform stack of identical blocks. */
function SkeletonMessageRow({
  side,
  bubbleWidth,
  lines = 1,
}: {
  side: 'self' | 'peer'
  bubbleWidth: string
  lines?: number
}) {
  const self = side === 'self'
  return (
    <div className={cn('flex flex-col', self ? 'items-end' : 'items-start')}>
      <div
        className={cn(
          'max-w-[85%] space-y-1.5 rounded-2xl px-3.5 py-2.5',
          self ? 'bg-primary/10' : 'bg-muted'
        )}
        style={{ width: bubbleWidth }}
      >
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 w-full bg-foreground/10" />
        ))}
      </div>
      {!self && <Skeleton className="mt-1 ms-1 h-2.5 w-20 bg-foreground/10" />}
    </div>
  )
}

/** Pending state for the ticket detail page, shaped like the loaded layout
 *  (title + stage tracker + message thread + composer, with the details rail
 *  on desktop) so data arriving doesn't cause a visible layout jump — the
 *  skeleton reserves the same outer structure `PortalTicketPage` renders once
 *  `ticket`/`thread` resolve. */
function TicketPageSkeleton() {
  return (
    <div className="lg:flex lg:items-start lg:gap-8">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="size-8 shrink-0 rounded-md" />
        </div>

        {/* Stage tracker */}
        <div className="mt-5 flex items-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-1 items-center gap-2">
              <Skeleton className="size-6 shrink-0 rounded-full" />
              {i < 3 && <Skeleton className="h-1 flex-1" />}
            </div>
          ))}
        </div>

        {/* Message thread */}
        <div className="mt-6 flex flex-col gap-3">
          <SkeletonMessageRow side="peer" bubbleWidth="70%" lines={2} />
          <SkeletonMessageRow side="self" bubbleWidth="45%" />
          <SkeletonMessageRow side="peer" bubbleWidth="85%" lines={3} />
          <SkeletonMessageRow side="self" bubbleWidth="55%" lines={2} />
        </div>

        {/* Composer */}
        <div className="mt-4 rounded-lg border border-border bg-background p-2">
          <Skeleton className="h-[72px] w-full rounded-md" />
          <div className="flex justify-end pt-1">
            <Skeleton className="h-8 w-20 rounded-md" />
          </div>
        </div>
      </div>

      {/* Details rail (desktop only, matches TicketDetailsRail) */}
      <aside className="mt-8 hidden lg:mt-0 lg:block lg:w-72 lg:shrink-0">
        <div className="space-y-4 rounded-xl border border-border/20 bg-card p-4 shadow-sm">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      </aside>
    </div>
  )
}

function PortalTicketPage() {
  const intl = useIntl()
  const { ticketId } = Route.useParams()
  const id = ticketId as TicketId
  const { session, settings } = useRouteContext({ from: '__root__' })
  const authPopover = useAuthPopoverSafe()
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
  // B19: the tracker's stage labels come from the workspace's customized set
  // (same source as the chips/emails); the defaults stand in until they land.
  const { data: stageLabels } = useQuery({
    ...portalTicketQueries.stageLabels(),
    enabled: supportTicketsEnabled && isLoggedIn,
  })
  // The intake form resolves the ticket's stored answers back to their field
  // labels for the details rail; reused across the requester's tickets, so it
  // shares one cached read.
  const { data: intakeForm } = useQuery({
    ...portalTicketQueries.form(),
    enabled: supportTicketsEnabled && isLoggedIn,
  })

  // Read-through (convergence Phase 2): viewing the ticket page marks the
  // pair's SHARED watermark read — on a linked pair the server writes the
  // CONVERSATION's visitor_last_read_at, so the Messages-space row/badge for
  // the pair clears on the same read (one watermark, reading either surface
  // marks both read). Re-fires when a new message lands while the page is
  // open (the thread query refetches), mirroring the agent thread's ticket
  // adapter. Fire-and-forget: a failed mark-read must never break the view.
  const threadLoaded = !!thread
  const lastMessageId = thread?.messages?.[thread.messages.length - 1]?.id ?? null
  useEffect(() => {
    if (!supportTicketsEnabled || !isLoggedIn || !threadLoaded) return
    void markMyTicketReadFn({ data: { ticketId: id } })
      .then(() => {
        // Clear the badges that read the shared watermark: the Tickets list
        // rows and the Messages-space conversation list.
        void queryClient.invalidateQueries({ queryKey: portalTicketKeys.list() })
        void queryClient.invalidateQueries({ queryKey: PORTAL_MY_CONVERSATIONS_QUERY_KEY })
      })
      .catch(() => {})
  }, [id, supportTicketsEnabled, isLoggedIn, threadLoaded, lastMessageId, queryClient])

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
      // Invalidate the whole tickets tree, not just the thread: a requester
      // reply auto-reopens the ticket (awaiting_requester → open), so the
      // detail-driven StageTracker/awaiting banner and the list's stage chip +
      // activity ordering would otherwise stay stale until they expire.
      void queryClient.invalidateQueries({ queryKey: portalTicketKeys.all() })
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
    <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 py-6">
      <BackLink to="/support" className="mb-4 self-start">
        <FormattedMessage id="portal.tickets.back" defaultMessage="All tickets" />
      </BackLink>

      {!isLoggedIn ? (
        // B16: a signed-out visitor who followed an email CTA lands here — gate
        // on sign-in (the shared auth popover, login happens in place and the
        // queries above enable on the same URL), never a misleading "not
        // found". Mirrors the Tickets list page's gate.
        <EmptyState
          icon={TicketIcon}
          title={intl.formatMessage({
            id: 'portal.tickets.detail.signIn.title',
            defaultMessage: 'Sign in to view your ticket',
          })}
          description={intl.formatMessage({
            id: 'portal.tickets.detail.signIn.body',
            defaultMessage: 'Your support tickets are tied to your account.',
          })}
          action={
            authPopover ? (
              <Button onClick={() => authPopover.openAuthPopover({ mode: 'login' })}>
                <FormattedMessage id="portal.tickets.signIn.cta" defaultMessage="Log in" />
              </Button>
            ) : undefined
          }
        />
      ) : isLoading ? (
        <TicketPageSkeleton />
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
        <div className="lg:flex lg:items-start lg:gap-8">
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-xl font-semibold leading-tight text-foreground">
                {ticket.title}
              </h1>
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
              <StageTracker
                slot={ticket.stage.slot}
                closed={ticket.stage.closed}
                labels={stageLabels ?? DEFAULT_TICKET_STAGE_LABELS}
                closedLabelId="portal.tickets.stage.closed"
              />
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
                messages.map((m) =>
                  // B25: a system event (stage crossing, the ticket_created
                  // conversion marker, pair-conversation chat events) renders as
                  // the centered muted notice, localized from its structured
                  // event — never as an agent-authored bubble of frozen English.
                  m.senderType === 'system' ? (
                    <SystemEventNotice key={m.id} event={m.systemEvent} fallback={m.content} />
                  ) : (
                    <VisitorMessageBubble
                      key={m.id}
                      content={m.content}
                      contentJson={m.contentJson}
                      side={m.senderType === 'visitor' ? 'self' : 'peer'}
                      authorName={m.author?.displayName ?? undefined}
                      selfLabel={intl.formatMessage({
                        id: 'portal.tickets.thread.you',
                        defaultMessage: 'You',
                      })}
                      isAssistant={m.isAssistant}
                      attachments={m.attachments}
                      citations={m.citations}
                      time={formatMessageTime(m.createdAt)}
                    />
                  )
                )
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
          </div>

          <TicketDetailsRail
            ticket={ticket}
            stageLabels={stageLabels ?? DEFAULT_TICKET_STAGE_LABELS}
            intakeTypes={intakeForm?.types ?? []}
          />
        </div>
      )}
    </div>
  )
}

/** One label/value row in the details rail — the muted icon+label on the start,
 *  the value on the end, matching the feedback-post metadata sidebar. */
function RailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </div>
      <div className="min-w-0 text-end text-sm font-medium text-foreground">{children}</div>
    </div>
  )
}

/** Render one stored intake answer as customer-facing text, keyed off the
 *  field's declared type (checkbox → Yes/No, date → localized day, lists →
 *  comma-joined). Returns null for an empty/unset answer so the caller can skip
 *  the row entirely. */
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

/**
 * The customer-facing ticket details rail (the requester's twin of the
 * feedback-post metadata sidebar): reference + status + dates up top, then the
 * intake answers the requester themselves gave, resolved back to their field
 * labels via the intake form. Mirrors the post sidebar's card aesthetic
 * (`rounded-xl border bg-card` rows) and, like it, is desktop-only.
 */
function TicketDetailsRail({
  ticket,
  stageLabels,
  intakeTypes,
}: {
  ticket: RequesterTicketDTO
  stageLabels: TicketStageLabels
  intakeTypes: TicketIntakeType[]
}) {
  const intl = useIntl()

  const stageLabel = ticket.stage.closed
    ? intl.formatMessage({ id: 'portal.tickets.stage.closed', defaultMessage: 'Closed' })
    : ticket.stage.slot
      ? stageLabels[ticket.stage.slot]
      : ticket.stage.label

  // Resolve the ticket's stored intake answers back to their field labels using
  // the type this ticket was filed under. Only customer-visible fields with a
  // real answer render (the form already carries only `visibleToCustomer` ones).
  const intakeType = ticket.ticketType
    ? intakeTypes.find((t) => t.id === ticket.ticketType?.id)
    : undefined
  const answers = (intakeType?.fields ?? [])
    .map((field) => ({
      field,
      text: formatIntakeValue(field, ticket.customAttributes[field.key], intl),
    }))
    .filter((a): a is { field: TicketFormField; text: string } => a.text !== null)

  const lastActivity = ticket.lastMessageAt ?? ticket.updatedAt

  return (
    <aside className="mt-8 lg:mt-0 lg:w-72 lg:shrink-0">
      <div
        className={cn(
          'rounded-xl border border-border/20 bg-card p-4 shadow-sm',
          'space-y-4 lg:sticky lg:top-6'
        )}
      >
        <RailRow
          icon={HashtagIcon}
          label={intl.formatMessage({
            id: 'portal.tickets.details.reference',
            defaultMessage: 'Reference',
          })}
        >
          <span className="font-mono">{ticket.reference}</span>
        </RailRow>

        {stageLabel && (
          <RailRow
            icon={ClockIcon}
            label={intl.formatMessage({
              id: 'portal.tickets.details.status',
              defaultMessage: 'Status',
            })}
          >
            {stageLabel}
          </RailRow>
        )}

        {ticket.ticketType && (
          <RailRow
            icon={Squares2X2Icon}
            label={intl.formatMessage({
              id: 'portal.tickets.details.type',
              defaultMessage: 'Type',
            })}
          >
            <span className="truncate">{ticket.ticketType.name}</span>
          </RailRow>
        )}

        <RailRow
          icon={CalendarIcon}
          label={intl.formatMessage({
            id: 'portal.tickets.details.opened',
            defaultMessage: 'Opened',
          })}
        >
          <TimeAgo
            date={new Date(ticket.createdAt)}
            className="text-sm font-medium text-foreground"
          />
        </RailRow>

        {lastActivity && (
          <RailRow
            icon={CalendarIcon}
            label={intl.formatMessage({
              id: 'portal.tickets.details.lastActivity',
              defaultMessage: 'Last activity',
            })}
          >
            <TimeAgo
              date={new Date(lastActivity)}
              className="text-sm font-medium text-foreground"
            />
          </RailRow>
        )}

        {answers.length > 0 && (
          <div className="space-y-3 border-t border-border/30 pt-4">
            {answers.map(({ field, text }) => (
              <div key={field.key}>
                <p className="text-xs text-muted-foreground">{field.label}</p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-foreground">
                  {text}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}
