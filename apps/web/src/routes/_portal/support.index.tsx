import { createFileRoute, Link, Navigate, useRouteContext } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { ChatBubbleLeftRightIcon, ChevronRightIcon, PlusIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { Spinner } from '@/components/shared/spinner'
import { TimeAgo } from '@/components/ui/time-ago'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { getMyConversationsFn } from '@/lib/server/functions/conversation'
import { PORTAL_MY_CONVERSATIONS_QUERY_KEY } from '@/lib/client/queries/portal-support'
import { PortalTicketsList } from '@/components/portal/portal-tickets-list'

export const Route = createFileRoute('/_portal/support/')({
  component: SupportListPage,
})

/** Status chip copy, localized per status (mirrors the widget's history list). */
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

function SupportListPage() {
  const intl = useIntl()
  const { session, settings } = useRouteContext({ from: '__root__' })
  const authPopover = useAuthPopoverSafe()

  // CONVERGENCE (scratchpad/convergence-design.md): the portal keeps TWO
  // spaces — Messages (the conversation list) + Tickets (status cards) —
  // Intercom's exact model. A conversation↔ticket pair dual-lists in BOTH
  // with ONE shared watermark and read-through (reading either marks both
  // read; the Tickets rows' badges read the linked conversation's visitor
  // watermark). The Tickets surface is the default space when it's on.
  const supportTicketsEnabled = !!settings?.featureFlags?.supportTickets
  const supportEnabled =
    !!settings?.featureFlags?.supportInbox && !!settings?.portalConfig?.support?.enabled
  const twoSpaces = supportTicketsEnabled && supportEnabled
  const [space, setSpace] = useState<'messages' | 'tickets'>('tickets')

  const user = session?.user
  const isLoggedIn = !!user && user.principalType !== 'anonymous'

  const { data, isLoading } = useQuery({
    queryKey: PORTAL_MY_CONVERSATIONS_QUERY_KEY,
    queryFn: () => getMyConversationsFn(),
    enabled: supportEnabled && isLoggedIn && (!supportTicketsEnabled || space === 'messages'),
    staleTime: 30_000,
  })

  // Tickets-only workspace (supportTickets on, supportInbox/portal-support
  // off): the Tickets surface stands alone — no Messages space to tab to.
  if (supportTicketsEnabled && !twoSpaces) {
    return <PortalTicketsList isLoggedIn={isLoggedIn} />
  }

  if (!supportEnabled) {
    return <Navigate to="/" />
  }

  const conversations = data?.conversations ?? []

  const messagesSpace = (
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
        {isLoggedIn && (
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
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
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
            <Button asChild>
              <Link to="/support/$conversationId" params={{ conversationId: 'new' }}>
                <PlusIcon className="me-1.5 h-4 w-4" />
                <FormattedMessage
                  id="portal.support.newConversation"
                  defaultMessage="New conversation"
                />
              </Link>
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                to="/support/$conversationId"
                params={{ conversationId: c.id }}
                className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {c.subject ||
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
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    <StatusLabel status={c.status} /> · <TimeAgo date={c.lastMessageAt} />
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  if (!twoSpaces) {
    return messagesSpace
  }

  // The two-space nav (Messages + Tickets). A pair lists in both: Messages
  // shows the conversation (native unread off the shared watermark), Tickets
  // shows the ticket card (badge via the link) — reading either marks both.
  return (
    <div>
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <div className="flex gap-1 border-b border-border/60 pt-4" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={space === 'messages'}
            onClick={() => setSpace('messages')}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              space === 'messages'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <FormattedMessage id="portal.support.tabs.messages" defaultMessage="Messages" />
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={space === 'tickets'}
            onClick={() => setSpace('tickets')}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              space === 'tickets'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            <FormattedMessage id="portal.support.tabs.tickets" defaultMessage="Tickets" />
          </button>
        </div>
      </div>
      {space === 'tickets' ? <PortalTicketsList isLoggedIn={isLoggedIn} /> : messagesSpace}
    </div>
  )
}
