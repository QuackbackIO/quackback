/**
 * The widget Tickets tab (widget ticket submission): the visitor's own support
 * tickets, newest-activity-first, with a pinned "New ticket" pill — the ticket
 * analog of `widget-messages.tsx`. Two identity tiers (D3): a verified visitor
 * sees the full list; an anonymous visitor who has captured an email sees their
 * in-session list with a "sign in to keep access" banner, while one who has not
 * yet gets a choice state that leads into the email-capture New-Ticket form.
 */
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { motion, useReducedMotion } from 'framer-motion'
import { TicketIcon, PlusIcon, ArrowRightIcon } from '@heroicons/react/24/solid'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import type { TicketId } from '@quackback/ids'
import { widgetTicketQueries } from '@/lib/client/queries/widget-tickets'
import { useWidgetAuth } from './widget-auth-provider'
import { TimeAgo } from '@/components/ui/time-ago'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/shared/utils'

interface WidgetTicketsProps {
  /** Open a ticket: an id opens that thread, 'new' starts a fresh ticket. */
  onOpenTicket: (target: TicketId | 'new') => void
}

/** Semantic soft-chip colors per customer-facing stage (ported from the portal
 *  StageChip): neutral while queued, blue while worked, amber when the ball is
 *  in the requester's court, emerald when done. */
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

export function WidgetTickets({ onOpenTicket }: WidgetTicketsProps) {
  const intl = useIntl()
  const reduceMotion = useReducedMotion()
  const { isIdentified, sessionVersion } = useWidgetAuth()

  const { data, isLoading, isError } = useQuery(widgetTicketQueries.list(sessionVersion))
  const tickets = data ?? []

  // Anonymous + no captured email → the list read fails EMAIL_REQUIRED; show the
  // choice state that leads into the email-capture form. Anonymous + a captured
  // email (list loaded) → their in-session tickets with a keep-access banner.
  const emailCaptureChoice = !isIdentified && isError

  if (emailCaptureChoice) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 pb-24 pt-12 text-center">
        <TicketIcon className="mb-3 h-10 w-10 text-muted-foreground/30" />
        <p className="text-sm font-semibold text-foreground">
          <FormattedMessage
            id="widget.tickets.choice.title"
            defaultMessage="Open a support ticket"
          />
        </p>
        <p className="mt-1 max-w-[16rem] text-xs text-muted-foreground">
          <FormattedMessage
            id="widget.tickets.choice.body"
            defaultMessage="Tell us what you need and we'll track it to resolution. We'll email you the updates."
          />
        </p>
        <button
          type="button"
          onClick={() => onOpenTicket('new')}
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:scale-[1.03] active:scale-[0.98]"
        >
          <FormattedMessage
            id="widget.tickets.choice.continue"
            defaultMessage="Continue with email"
          />
          <ArrowRightIcon className="h-4 w-4 rtl:rotate-180" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      <ScrollArea scrollBarClassName="w-1.5" className="h-full min-h-0 flex-1">
        {!isIdentified && tickets.length > 0 && (
          <div className="mx-3 mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.04] px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
            <FormattedMessage
              id="widget.tickets.keepAccessBanner"
              defaultMessage="Sign in to keep access to these tickets on any device. We'll still email you every update."
            />
          </div>
        )}

        {tickets.length > 0 ? (
          <ul className="px-3 pb-24 pt-2">
            {tickets.map((t) => (
              <li key={t.id} className="border-b border-border/40 last:border-b-0">
                <button
                  type="button"
                  onClick={() => onOpenTicket(t.id)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-start transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {t.title}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70">
                        {t.reference}
                      </span>
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <TimeAgo date={t.updatedAt} />
                    </span>
                  </span>
                  {/* Unread badge — the pair's SHARED watermark (the linked
                      conversation's visitor_last_read_at); reading either the
                      ticket or the conversation clears it (read-through). */}
                  {t.unreadCount > 0 && (
                    <span className="inline-flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold leading-[18px] text-primary-foreground">
                      {t.unreadCount}
                    </span>
                  )}
                  <StageChip slot={t.stage.slot} label={t.stage.label} />
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 rtl:rotate-180" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !isLoading && (
            <div className="flex h-full flex-col items-center justify-center px-6 pb-24 pt-16 text-center">
              <TicketIcon className="mb-2 h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground/70">
                <FormattedMessage id="widget.tickets.empty" defaultMessage="No tickets yet" />
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground/50">
                <FormattedMessage
                  id="widget.tickets.emptyHint"
                  defaultMessage="Open a ticket and we'll track it for you."
                />
              </p>
            </div>
          )
        )}
      </ScrollArea>

      {/* Pinned pill — always available, floating above the list. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
        <motion.button
          type="button"
          onClick={() => onOpenTicket('new')}
          initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1], delay: 0.08 }}
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.98]"
          aria-label={intl.formatMessage({
            id: 'widget.tickets.new',
            defaultMessage: 'New ticket',
          })}
        >
          <FormattedMessage id="widget.tickets.new" defaultMessage="New ticket" />
          <PlusIcon className="h-4 w-4" />
        </motion.button>
      </div>
    </div>
  )
}
