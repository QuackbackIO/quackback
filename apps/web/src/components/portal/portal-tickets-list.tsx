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
import {
  TicketIcon,
  ChevronRightIcon,
  PlusIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { Spinner } from '@/components/shared/spinner'
import { TimeAgo } from '@/components/ui/time-ago'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { searchMyTicketsFn } from '@/lib/server/functions/tickets'
import { portalTicketQueries, portalTicketKeys } from '@/lib/client/queries/portal-tickets'
import { NewPortalTicketDialog } from '@/components/portal/new-portal-ticket-dialog'

/** Render a ts_headline snippet safely: split on the <mark> tags we asked for and
 *  render each piece as an escaped React node (never dangerouslySetInnerHTML). */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(<mark>|<\/mark>)/)
  let on = false
  return (
    <>
      {parts.map((p, i) => {
        if (p === '<mark>') {
          on = true
          return null
        }
        if (p === '</mark>') {
          on = false
          return null
        }
        return on ? (
          <mark key={i} className="rounded bg-primary/20 px-0.5 text-foreground">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      })}
    </>
  )
}

/** Semantic soft-chip colors per customer-facing stage — neutral while queued,
 *  blue while worked, amber when the ball is in the requester's court
 *  (Intercom's "waiting on customer" attention state), emerald when done. */
const STAGE_CHIP_CLASS: Record<string, string> = {
  received: 'bg-muted/60 text-muted-foreground',
  in_progress: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  awaiting_requester: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  resolved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
}

function StageChip({ slot, label }: { slot: string | null; label: string | null }) {
  if (!label) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
        (slot && STAGE_CHIP_CLASS[slot]) ?? 'bg-muted/60 text-muted-foreground'
      )}
    >
      {label}
    </span>
  )
}

export function PortalTicketsList({ isLoggedIn }: { isLoggedIn: boolean }) {
  const intl = useIntl()
  const authPopover = useAuthPopoverSafe()
  const [newOpen, setNewOpen] = useState(false)

  const [query, setQuery] = useState('')
  const debounced = useDebouncedValue(query, 300)
  const searching = debounced.trim().length > 1

  const { data: tickets, isLoading } = useQuery({
    ...portalTicketQueries.list(),
    enabled: isLoggedIn,
  })

  const { data: results, isFetching: isSearching } = useQuery({
    queryKey: [...portalTicketKeys.all(), 'search', debounced],
    queryFn: () => searchMyTicketsFn({ data: { query: debounced } }),
    enabled: isLoggedIn && searching,
    staleTime: 10_000,
  })

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-8">
      <PageHeader
        size="large"
        title={intl.formatMessage({ id: 'portal.tickets.title', defaultMessage: 'Tickets' })}
        description={intl.formatMessage({
          id: 'portal.tickets.subtitle',
          defaultMessage: 'Track your requests through to resolution',
        })}
        action={
          isLoggedIn ? (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <PlusIcon className="me-1.5 h-4 w-4" />
              <FormattedMessage id="portal.tickets.new" defaultMessage="New ticket" />
            </Button>
          ) : undefined
        }
        animate
        className="mb-6"
      />

      {isLoggedIn && (
        <div className="relative mb-4">
          <MagnifyingGlassIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={intl.formatMessage({
              id: 'portal.tickets.search.placeholder',
              defaultMessage: 'Search your tickets…',
            })}
            className="ps-9"
          />
        </div>
      )}

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
      ) : searching ? (
        isSearching && !results ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : (results ?? []).length === 0 ? (
          <EmptyState
            icon={MagnifyingGlassIcon}
            title={intl.formatMessage({
              id: 'portal.tickets.search.empty.title',
              defaultMessage: 'No matching tickets',
            })}
            description={intl.formatMessage({
              id: 'portal.tickets.search.empty.body',
              defaultMessage: 'Try a different search.',
            })}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {(results ?? []).map((r) => (
              <li key={r.ticket.id}>
                <Link
                  to="/support/ticket/$ticketId"
                  params={{ ticketId: r.ticket.id }}
                  className="flex w-full items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {r.ticket.title}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                        {r.ticket.reference}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      <Highlighted text={r.snippet} />
                    </span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 rtl:rotate-180" />
                </Link>
              </li>
            ))}
          </ul>
        )
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
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{t.title}</span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                      {t.reference}
                    </span>
                  </span>
                  <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <TimeAgo date={t.updatedAt} />
                  </span>
                </span>
                <StageChip slot={t.stage.slot} label={t.stage.label} />
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
