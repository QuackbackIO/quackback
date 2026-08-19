import { createFileRoute, Link, Navigate, useRouteContext } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { ChatBubbleLeftRightIcon, ChevronRightIcon, PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeAgo } from '@/components/ui/time-ago'
import { StageChip } from '@/components/shared/ticket-stage'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { getMyConversationsFn } from '@/lib/server/functions/conversation'
import { PORTAL_MY_CONVERSATIONS_QUERY_KEY } from '@/lib/client/queries/portal-support'

export const Route = createFileRoute('/_portal/support/')({
  component: SupportListPage,
})

/** Status chip copy for an unpaired conversation, localized per status. */
function StatusLabel({ status }: { status: string }) {
  switch (status) {
    // Snooze is internal queue discipline; customers see a snoozed thread as open.
    case 'open':
    case 'snoozed':
      return <FormattedMessage id="portal.support.status.open" defaultMessage="Open" />
    case 'closed':
      return <FormattedMessage id="portal.support.status.closed" defaultMessage="Closed" />
    default:
      return <>{status}</>
  }
}

/** Pending state for the Messages list — mirrors the loaded `<li>` row (title +
 *  status/time line, in a bordered card) so the list doesn't reflow height when
 *  the real rows arrive. */
function ConversationListSkeleton() {
  return (
    <ul className="flex flex-col gap-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3"
        >
          <span className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </span>
          <Skeleton className="size-4 shrink-0 rounded-full" />
        </li>
      ))}
    </ul>
  )
}

/**
 * The portal Messages surface — ONE list for every thread the requester has
 * with the team, chat- and ticket-backed alike (converged Messages: a customer
 * ticket IS a conversation pair). Paired rows carry their ticket's StageChip +
 * reference and key their displayed state off the TICKET stage (the pair-state
 * rule); unpaired rows keep the plain Open/Closed status. The chat-start
 * button gates on the messenger being enabled — an email-first (tickets-only)
 * workspace still lists and opens its threads here.
 */
function SupportListPage() {
  const intl = useIntl()
  const { session, settings } = useRouteContext({ from: '__root__' })
  const authPopover = useAuthPopoverSafe()

  const supportTicketsEnabled = !!settings?.featureFlags?.supportTickets
  const messengerEnabled =
    !!settings?.featureFlags?.supportInbox && !!settings?.portalConfig?.support?.enabled
  const surfaceEnabled = messengerEnabled || supportTicketsEnabled

  const user = session?.user
  const isLoggedIn = !!user && user.principalType !== 'anonymous'

  const { data, isLoading } = useQuery({
    queryKey: PORTAL_MY_CONVERSATIONS_QUERY_KEY,
    queryFn: () => getMyConversationsFn(),
    enabled: surfaceEnabled && isLoggedIn,
    staleTime: 30_000,
  })

  if (!surfaceEnabled) {
    return <Navigate to="/" />
  }

  const conversations = data?.conversations ?? []
  const linkedTickets = data?.linkedTickets ?? {}

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            <FormattedMessage id="portal.support.title" defaultMessage="Support" />
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.support.subtitle"
              defaultMessage="Your conversations with our team"
            />
          </p>
        </div>
        {isLoggedIn && messengerEnabled && (
          <Button asChild size="sm">
            <Link to="/support/$conversationId" params={{ conversationId: 'new' }}>
              <PlusIcon className="me-1.5 h-4 w-4" />
              <FormattedMessage
                id="portal.support.newConversation"
                defaultMessage="New conversation"
              />
            </Link>
          </Button>
        )}
      </div>

      {!isLoggedIn ? (
        <EmptyState
          icon={ChatBubbleLeftRightIcon}
          title={intl.formatMessage({
            id: 'portal.support.signIn.title',
            defaultMessage: 'Sign in to view your conversations',
          })}
          description={intl.formatMessage({
            id: 'portal.support.signIn.body',
            defaultMessage: 'Your support conversations are tied to your account.',
          })}
          action={
            authPopover ? (
              <Button onClick={() => authPopover.openAuthPopover({ mode: 'login' })}>
                <FormattedMessage id="portal.support.signIn.cta" defaultMessage="Log in" />
              </Button>
            ) : undefined
          }
        />
      ) : isLoading ? (
        <ConversationListSkeleton />
      ) : conversations.length === 0 ? (
        <EmptyState
          icon={ChatBubbleLeftRightIcon}
          title={intl.formatMessage({
            id: 'portal.support.empty.title',
            defaultMessage: 'No conversations yet',
          })}
          description={intl.formatMessage({
            id: 'portal.support.empty.body',
            defaultMessage: "Start a conversation and we'll get back to you.",
          })}
          action={
            messengerEnabled ? (
              <Button asChild>
                <Link to="/support/$conversationId" params={{ conversationId: 'new' }}>
                  <PlusIcon className="me-1.5 h-4 w-4" />
                  <FormattedMessage
                    id="portal.support.newConversation"
                    defaultMessage="New conversation"
                  />
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((c) => {
            const ticket = linkedTickets[c.id]
            return (
              <li key={c.id}>
                <Link
                  to="/support/$conversationId"
                  params={{ conversationId: c.id }}
                  className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {ticket?.title ||
                          c.subject ||
                          c.lastMessagePreview ||
                          intl.formatMessage({
                            id: 'portal.support.untitled',
                            defaultMessage: 'Conversation',
                          })}
                      </span>
                      {(c.unreadCount ?? 0) > 0 && (
                        <span className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-[18px] text-primary-foreground">
                          {c.unreadCount}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {ticket ? (
                        // Pair-state rule: the ticket's stage is the row's
                        // displayed truth (a closed conversation with an open
                        // ticket must not read "Closed").
                        <>
                          <StageChip
                            slot={ticket.stage.slot}
                            label={ticket.stage.label}
                            closed={ticket.stage.closed}
                            closedLabelId="portal.tickets.stage.closed"
                          />
                          <span className="font-mono text-[11px] text-muted-foreground/70">
                            {ticket.reference}
                          </span>
                        </>
                      ) : (
                        <StatusLabel status={c.status} />
                      )}
                      <span>·</span>
                      <TimeAgo date={c.lastMessageAt} />
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 rtl:rotate-180" />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
