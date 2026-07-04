/**
 * The portal Tickets surface (support platform §4.2, 7C): a requester's own
 * customer tickets with a create affordance. Replaces the interim portal
 * conversations list once `supportTickets` is on. Thread-first — a row links to
 * the ticket's thread + public-stage tracker.
 */
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { TicketIcon, ChevronRightIcon, PlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { Spinner } from '@/components/shared/spinner'
import { TimeAgo } from '@/components/ui/time-ago'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { portalTicketQueries } from '@/lib/client/queries/portal-tickets'
import { NewPortalTicketDialog } from '@/components/portal/new-portal-ticket-dialog'

/** A muted chip for the ticket's customer-facing stage. Resolved reads as done. */
function StageChip({ slot, label }: { slot: string | null; label: string | null }) {
  if (!label) return null
  const done = slot === 'resolved'
  return (
    <span
      className={
        done
          ? 'inline-flex shrink-0 items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300'
          : 'inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary'
      }
    >
      {label}
    </span>
  )
}

export function PortalTicketsList({ isLoggedIn }: { isLoggedIn: boolean }) {
  const intl = useIntl()
  const authPopover = useAuthPopoverSafe()
  const [newOpen, setNewOpen] = useState(false)

  const { data: tickets, isLoading } = useQuery({
    ...portalTicketQueries.list(),
    enabled: isLoggedIn,
  })

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            <FormattedMessage id="portal.tickets.title" defaultMessage="Tickets" />
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.tickets.subtitle"
              defaultMessage="Track your requests through to resolution"
            />
          </p>
        </div>
        {isLoggedIn && (
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <PlusIcon className="me-1.5 h-4 w-4" />
            <FormattedMessage id="portal.tickets.new" defaultMessage="New ticket" />
          </Button>
        )}
      </div>

      {!isLoggedIn ? (
        <EmptyState
          icon={TicketIcon}
          title={intl.formatMessage({
            id: 'portal.tickets.signIn.title',
            defaultMessage: 'Sign in to view your tickets',
          })}
          description={intl.formatMessage({
            id: 'portal.tickets.signIn.body',
            defaultMessage: 'Your tickets are tied to your account.',
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
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : (tickets ?? []).length === 0 ? (
        <EmptyState
          icon={TicketIcon}
          title={intl.formatMessage({
            id: 'portal.tickets.empty.title',
            defaultMessage: 'No tickets yet',
          })}
          description={intl.formatMessage({
            id: 'portal.tickets.empty.body',
            defaultMessage: 'Open a ticket and we will track it for you.',
          })}
          action={
            <Button onClick={() => setNewOpen(true)}>
              <PlusIcon className="me-1.5 h-4 w-4" />
              <FormattedMessage id="portal.tickets.new" defaultMessage="New ticket" />
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {(tickets ?? []).map((t) => (
            <li key={t.id}>
              <Link
                to="/support/ticket/$ticketId"
                params={{ ticketId: t.id }}
                className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-muted-foreground/70">
                      {t.reference}
                    </span>
                    <span className="truncate text-sm font-medium text-foreground">{t.title}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <StageChip slot={t.stage.slot} label={t.stage.label} />
                    <TimeAgo date={t.updatedAt} />
                  </span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 rtl:rotate-180" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewPortalTicketDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  )
}
