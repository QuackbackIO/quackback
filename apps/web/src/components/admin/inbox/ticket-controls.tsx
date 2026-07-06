/**
 * The interactive ticket property controls (support platform §4.2): status,
 * assignee, and priority. Each is a dropdown that calls the matching gated
 * server fn and reuses the conversation inbox's menu pieces (PriorityMenuItems,
 * AssigneeMenuItems, the team roster) so tickets and conversations feel the same.
 */
import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, CheckIcon, UserCircleIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import type { ConversationPriority } from '@/lib/shared/db-types'
import { DEFAULT_TICKET_STAGE_LABELS } from '@/lib/shared/tickets'
import { priorityMeta } from '@/lib/shared/conversation/priority-meta'
import { PriorityDot, PriorityMenuItems } from '@/components/admin/conversation/priority-control'
import { AssigneeMenuItems } from '@/components/admin/conversation/assignee-control'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { useInboxTeams } from '@/components/admin/conversation/inbox-nav-sidebar'
import { ticketQueries } from '@/lib/client/queries/inbox'
import {
  useSetTicketStatus,
  useAssignTicket,
  useSetTicketPriority,
} from '@/lib/client/mutations/inbox'
import { TicketStatusChip } from '@/components/admin/inbox/ticket-chips'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/shared/utils'

const triggerClass =
  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50'

/**
 * View + change a ticket's status. The trigger shows the current status chip; the
 * menu lists every status with the requester stage it projects to.
 */
export function TicketStatusControl({
  ticket,
  onChanged,
  align = 'end',
}: {
  ticket: TicketDTO
  onChanged?: () => void
  align?: 'start' | 'end'
}) {
  const { data: statuses } = useQuery(ticketQueries.statuses())
  // Workspace stage labels so the picker shows a renamed stage, not the default.
  const { data: stageLabels } = useQuery(ticketQueries.stageLabels())
  const mutation = useSetTicketStatus()
  const select = (statusId: TicketDTO['status']['id']) => {
    if (statusId === ticket.status.id) return
    mutation.mutate(
      { ticketId: ticket.id, statusId },
      { onSuccess: () => onChanged?.(), onError: () => toast.error('Failed to update status') }
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={mutation.isPending} className={cn(triggerClass, 'px-1.5')}>
          <TicketStatusChip status={ticket.status} />
          <ChevronDownIcon className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-80 overflow-y-auto">
        {statuses?.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onClick={() => select(s.id)}
            className="flex items-center gap-2 text-xs"
          >
            <span
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            {s.publicStage && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {stageLabels?.[s.publicStage] ?? DEFAULT_TICKET_STAGE_LABELS[s.publicStage]}
              </span>
            )}
            {s.id === ticket.status.id && (
              <CheckIcon className="ml-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Assign a ticket to a teammate or a team (polymorphic + independent, mirroring
 * the inbox). Teammate rows reuse AssigneeMenuItems; the team roster is appended.
 */
export function TicketAssigneeControl({
  ticket,
  onChanged,
}: {
  ticket: TicketDTO
  onChanged?: () => void
}) {
  const { data: members } = useTeamMembers()
  const { data: teams } = useInboxTeams()
  const mutation = useAssignTicket()
  const { assignee } = ticket

  const run = (vars: { assigneePrincipalId?: string | null; assigneeTeamId?: string | null }) =>
    mutation.mutate(
      { ticketId: ticket.id, ...vars },
      { onSuccess: () => onChanged?.(), onError: () => toast.error('Failed to assign ticket') }
    )

  const label = assignee.principalId
    ? (assignee.displayName ?? 'Assigned')
    : assignee.teamId
      ? (assignee.teamName ?? 'Team')
      : 'Unassigned'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={mutation.isPending} className={triggerClass}>
          {assignee.principalId ? (
            <Avatar
              src={undefined}
              name={assignee.displayName ?? 'Agent'}
              className="size-4 text-[8px]"
            />
          ) : (
            <UserCircleIcon className="h-4 w-4" />
          )}
          <span className="max-w-28 truncate">{label}</span>
          <ChevronDownIcon className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        <AssigneeMenuItems
          members={members}
          selectedPrincipalId={assignee.principalId}
          showUnassign={!!assignee.principalId}
          onSelect={(assignTo) => run({ assigneePrincipalId: assignTo })}
        />
        {teams && teams.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              Teams
            </DropdownMenuLabel>
            {assignee.teamId && (
              <DropdownMenuItem onClick={() => run({ assigneeTeamId: null })} className="text-xs">
                Clear team
              </DropdownMenuItem>
            )}
            {teams.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => run({ assigneeTeamId: t.id })}
                className="flex items-center gap-2 text-xs"
              >
                <span
                  className="inline-block size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: t.color }}
                />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {assignee.teamId === t.id && (
                  <CheckIcon className="ml-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** View + change a ticket's priority (reuses the inbox priority menu). */
export function TicketPriorityControl({
  ticket,
  onChanged,
}: {
  ticket: TicketDTO
  onChanged?: () => void
}) {
  const mutation = useSetTicketPriority()
  const meta = priorityMeta(ticket.priority)
  const select = (priority: ConversationPriority) =>
    mutation.mutate(
      { ticketId: ticket.id, priority },
      { onSuccess: () => onChanged?.(), onError: () => toast.error('Failed to set priority') }
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={mutation.isPending} className={triggerClass}>
          <PriorityDot priority={ticket.priority} />
          {ticket.priority === 'none' ? 'Priority' : meta.label}
          <ChevronDownIcon className="h-3 w-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <PriorityMenuItems selected={ticket.priority} onSelect={select} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
