import { useIntl } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import {
  PlusIcon,
  ArrowPathIcon,
  ArrowsRightLeftIcon,
  FlagIcon,
  TrashIcon,
  UserIcon,
} from '@heroicons/react/16/solid'
import type { IntlShape } from 'react-intl'
import type { TicketId } from '@quackback/ids'
import type { TicketActivityType } from '@/lib/server/domains/tickets'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import { activityQueries } from '@/lib/client/queries/activity'
import { priorityMeta } from '@/lib/shared/conversation/priority-meta'
import { Skeleton } from '@/components/ui/skeleton'
import { TimeAgo } from '@/components/ui/time-ago'

/** Wire shape of one activity row from fetchTicketActivityFn. */
interface TicketActivityItem {
  id: string
  ticketId: string
  principalId: string | null
  type: TicketActivityType
  metadata: Record<string, unknown>
  createdAt: string | Date
  actorName: string | null
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function actorLabel(intl: IntlShape, name: string | null): string {
  return (
    name ??
    intl.formatMessage({ id: 'admin.ticketActivity.system', defaultMessage: 'System' })
  )
}

/** "{from} → {to}" detail line, with an Unassigned placeholder for a null side. */
function fromTo(intl: IntlShape, from: string | null, to: string | null): string {
  const none = intl.formatMessage({
    id: 'admin.ticketActivity.none',
    defaultMessage: 'Unassigned',
  })
  return intl.formatMessage(
    { id: 'admin.ticketActivity.fromTo', defaultMessage: '{from} → {to}' },
    { from: from ?? none, to: to ?? none }
  )
}

interface RowContent {
  icon: React.ComponentType<{ className?: string }>
  label: string
  details: string[]
}

/** Human-readable label + detail lines for one activity row. */
function rowContent(intl: IntlShape, item: TicketActivityItem): RowContent | null {
  const actor = actorLabel(intl, item.actorName)
  const m = item.metadata

  switch (item.type) {
    case 'ticket.created':
      return {
        icon: PlusIcon,
        label: intl.formatMessage(
          { id: 'admin.ticketActivity.created', defaultMessage: '{actor} created this ticket' },
          { actor }
        ),
        details: [],
      }
    case 'status.changed':
      return {
        icon: ArrowsRightLeftIcon,
        label: intl.formatMessage(
          { id: 'admin.ticketActivity.statusChanged', defaultMessage: '{actor} changed status' },
          { actor }
        ),
        details: [fromTo(intl, str(m.fromName), str(m.toName))],
      }
    case 'ticket.assigned': {
      const principalMoved = 'toPrincipalId' in m
      const teamMoved = 'toTeamId' in m
      const details: string[] = []
      let label: string
      if (principalMoved && teamMoved) {
        label = intl.formatMessage(
          {
            id: 'admin.ticketActivity.assignmentUpdated',
            defaultMessage: '{actor} updated the assignment',
          },
          { actor }
        )
        details.push(fromTo(intl, str(m.fromPrincipalName), str(m.toPrincipalName)))
        details.push(fromTo(intl, str(m.fromTeamName), str(m.toTeamName)))
      } else if (teamMoved) {
        label = m.toTeamId
          ? intl.formatMessage(
              {
                id: 'admin.ticketActivity.teamAssigned',
                defaultMessage: '{actor} assigned the {name} team',
              },
              { actor, name: str(m.toTeamName) ?? '—' }
            )
          : intl.formatMessage(
              {
                id: 'admin.ticketActivity.teamUnassigned',
                defaultMessage: '{actor} removed the team',
              },
              { actor }
            )
        if (m.fromTeamName) {
          details.push(
            intl.formatMessage(
              { id: 'admin.ticketActivity.previously', defaultMessage: 'Previously: {name}' },
              { name: str(m.fromTeamName) }
            )
          )
        }
      } else {
        label = m.toPrincipalId
          ? intl.formatMessage(
              { id: 'admin.ticketActivity.assigned', defaultMessage: '{actor} assigned {name}' },
              { actor, name: str(m.toPrincipalName) ?? '—' }
            )
          : intl.formatMessage(
              {
                id: 'admin.ticketActivity.unassigned',
                defaultMessage: '{actor} removed the assignee',
              },
              { actor }
            )
        if (m.fromPrincipalName) {
          details.push(
            intl.formatMessage(
              { id: 'admin.ticketActivity.previously', defaultMessage: 'Previously: {name}' },
              { name: str(m.fromPrincipalName) }
            )
          )
        }
      }
      return { icon: UserIcon, label, details }
    }
    case 'priority.changed':
      return {
        icon: FlagIcon,
        label: intl.formatMessage(
          {
            id: 'admin.ticketActivity.priorityChanged',
            defaultMessage: '{actor} set priority to {priority}',
          },
          {
            actor,
            priority: priorityMeta((str(m.to) ?? 'none') as ConversationPriority).label,
          }
        ),
        details: [],
      }
    case 'ticket.reopened':
      return {
        icon: ArrowPathIcon,
        label: item.actorName
          ? intl.formatMessage(
              {
                id: 'admin.ticketActivity.reopened',
                defaultMessage: '{actor} reopened this ticket by replying',
              },
              { actor }
            )
          : intl.formatMessage({
              id: 'admin.ticketActivity.reopenedSystem',
              defaultMessage: 'Reopened by a requester reply',
            }),
        details: [fromTo(intl, str(m.fromName), str(m.toName))],
      }
    case 'ticket.deleted':
      return {
        icon: TrashIcon,
        label: intl.formatMessage(
          { id: 'admin.ticketActivity.deleted', defaultMessage: '{actor} deleted this ticket' },
          { actor }
        ),
        details: [],
      }
    default:
      return null
  }
}

/**
 * The ticket's durable activity timeline (admin detail panel section): one
 * row per recorded state change — actor (or System), what changed, and a
 * relative timestamp. Read path is TICKET_VIEW + assertTicketVisible via
 * fetchTicketActivityFn.
 */
export function TicketActivityTimeline({
  ticketId,
  enabled = true,
}: {
  ticketId: TicketId
  /** Gate the fetch on panel visibility (the detail panel is hidden < xl). */
  enabled?: boolean
}) {
  const intl = useIntl()
  const { data, isLoading } = useQuery({
    ...activityQueries.forTicket(ticketId),
    enabled,
  })
  const activities = data as TicketActivityItem[] | undefined

  if (isLoading) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <Skeleton className="size-5 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!activities?.length) {
    return (
      <p className="text-xs text-muted-foreground">
        {intl.formatMessage({
          id: 'admin.ticketActivity.empty',
          defaultMessage: 'No activity recorded yet',
        })}
      </p>
    )
  }

  return (
    <div className="space-y-2.5">
      {activities.map((activity) => {
        const content = rowContent(intl, activity)
        if (!content) return null
        const Icon = content.icon
        return (
          <div key={activity.id} className="flex items-start gap-2.5">
            <div className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
              <Icon className="size-3 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 text-[13px] leading-snug text-foreground">
                  {content.label}
                </p>
                <TimeAgo
                  date={activity.createdAt}
                  className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground"
                />
              </div>
              {content.details.map((detail, i) => (
                <p key={i} className="mt-0.5 truncate text-xs text-muted-foreground">
                  {detail}
                </p>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
