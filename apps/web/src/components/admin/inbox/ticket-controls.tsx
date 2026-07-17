/**
 * The interactive ticket property controls (support platform §4.2): status,
 * assignee, and priority. Each is a dropdown that calls the matching gated
 * server fn and reuses the conversation inbox's menu pieces (PriorityMenuItems,
 * AssigneeMenuItems, the team roster) so tickets and conversations feel the same.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDownIcon,
  CheckIcon,
  UserCircleIcon,
  BellIcon,
  BellSlashIcon,
} from '@heroicons/react/24/solid'
import { PlusIcon, XMarkIcon } from '@heroicons/react/16/solid'
import { toast } from 'sonner'
import type { TicketId, PrincipalId } from '@quackback/ids'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import type { TicketWatcher } from '@/lib/server/domains/tickets/ticket-subscription.service'
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
  useWatchTicket,
  useUnwatchTicket,
  useMuteTicket,
  useUnmuteTicket,
  useAdminAddTicketWatcher,
  useAdminRemoveTicketWatcher,
} from '@/lib/client/mutations/inbox'
import { TicketStatusChip } from '@/components/admin/inbox/ticket-chips'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/shared/utils'

const triggerClass =
  'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50'

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
          <ChevronDownIcon className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="max-h-80 overflow-y-auto">
        {statuses?.map((s) => (
          <DropdownMenuItem
            key={s.id}
            onClick={() => select(s.id)}
            className="flex items-center gap-2"
          >
            <span
              className="inline-block size-2 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            {s.publicStage && (
              <span className="shrink-0 text-xs text-muted-foreground">
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
              className="size-4 text-xs"
            />
          ) : (
            <UserCircleIcon className="h-4 w-4" />
          )}
          <span className="max-w-28 truncate">{label}</span>
          <ChevronDownIcon className="size-3.5 shrink-0" />
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
              <DropdownMenuItem onClick={() => run({ assigneeTeamId: null })}>
                Clear team
              </DropdownMenuItem>
            )}
            {teams.map((t) => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => run({ assigneeTeamId: t.id })}
                className="flex items-center gap-2"
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
          <ChevronDownIcon className="size-3.5 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <PriorityMenuItems selected={ticket.priority} onSelect={select} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// Watchers (support platform ticket-watchers): the caller's own watch/mute
// state, plus a lighter version of the post voters stack — an overlapping
// avatar stack capped at 5 that opens a Popover (not a modal) listing every
// watcher, with a per-row remove and a compact add-watcher select scoped to
// the same teammate roster the assignee control reads.
// ---------------------------------------------------------------------------

const REASON_LABEL: Record<TicketWatcher['reason'], string> = {
  requester: 'Requester',
  assignee: 'Assignee',
  replier: 'Replied',
  manual: 'Added',
}

function isMuted(mutedUntil: Date | string | null | undefined): boolean {
  if (!mutedUntil) return false
  return new Date(mutedUntil).getTime() > Date.now()
}

/** The caller's own watch/mute control, plus the watcher avatar stack. Renders
 *  in the ticket Properties section (inbox-detail-panel.tsx), ticket items only. */
export function TicketWatchControl({ ticketId }: { ticketId: TicketId }) {
  const { data: status } = useQuery(ticketQueries.watchStatus(ticketId))
  const { data: watchers } = useQuery(ticketQueries.watchers(ticketId))
  const watch = useWatchTicket()
  const unwatch = useUnwatchTicket()
  const mute = useMuteTicket()
  const unmute = useUnmuteTicket()

  const watching = status?.watching ?? false
  const muted = isMuted(status?.mutedUntil)
  const pending = watch.isPending || unwatch.isPending || mute.isPending || unmute.isPending

  const label = muted ? 'Muted' : watching ? 'Watching' : 'Watch'
  const TriggerIcon = muted ? BellSlashIcon : BellIcon

  return (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={pending} className={triggerClass}>
            <TriggerIcon className="size-4" />
            <span>{label}</span>
            <ChevronDownIcon className="size-3.5 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!watching && (
            <DropdownMenuItem
              onClick={() =>
                watch.mutate({ ticketId }, { onError: () => toast.error('Failed to watch ticket') })
              }
            >
              <BellIcon className="size-4" /> Watch
            </DropdownMenuItem>
          )}
          {watching && (
            <DropdownMenuItem
              onClick={() =>
                unwatch.mutate(
                  { ticketId },
                  { onError: () => toast.error('Failed to unwatch ticket') }
                )
              }
            >
              <BellSlashIcon className="size-4" /> Unwatch
            </DropdownMenuItem>
          )}
          {watching && !muted && (
            <DropdownMenuItem
              onClick={() =>
                mute.mutate(
                  { ticketId, days: 7 },
                  { onError: () => toast.error('Failed to mute ticket') }
                )
              }
            >
              <BellSlashIcon className="size-4" /> Mute for a week
            </DropdownMenuItem>
          )}
          {muted && (
            <DropdownMenuItem
              onClick={() =>
                unmute.mutate(
                  { ticketId },
                  { onError: () => toast.error('Failed to unmute ticket') }
                )
              }
            >
              <BellIcon className="size-4" /> Unmute
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <WatcherAvatarStack ticketId={ticketId} watchers={watchers} />
    </div>
  )
}

function WatcherAvatarStack({
  ticketId,
  watchers,
}: {
  ticketId: TicketId
  watchers: TicketWatcher[] | undefined
}) {
  const [open, setOpen] = useState(false)
  const displayed = watchers?.slice(0, 5) ?? []
  const remaining = Math.max(0, (watchers?.length ?? 0) - 5)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {displayed.length > 0 ? (
          <button
            type="button"
            className="flex items-center -space-x-2 transition-opacity hover:opacity-80"
            aria-label="Manage watchers"
          >
            {displayed.map((w, i) => (
              <Avatar
                key={w.principalId}
                src={w.avatarUrl}
                name={w.displayName ?? 'Watcher'}
                className="size-6 text-xs ring-2 ring-background"
                style={{ zIndex: i + 1 }}
              />
            ))}
            {remaining > 0 && (
              <span
                className="relative flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1 text-[11px] font-medium text-muted-foreground ring-2 ring-background"
                style={{ zIndex: displayed.length + 1 }}
              >
                +{remaining}
              </span>
            )}
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[13px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <PlusIcon className="size-3" />
            <span>Add watcher</span>
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0" sideOffset={4}>
        <WatcherManagePanel ticketId={ticketId} watchers={watchers ?? []} />
      </PopoverContent>
    </Popover>
  )
}

function WatcherManagePanel({
  ticketId,
  watchers,
}: {
  ticketId: TicketId
  watchers: TicketWatcher[]
}) {
  const { data: members } = useTeamMembers()
  const addWatcher = useAdminAddTicketWatcher()
  const removeWatcher = useAdminRemoveTicketWatcher()

  const watcherIds = new Set(watchers.map((w) => w.principalId))
  const candidates = (members ?? []).filter((m) => !watcherIds.has(m.id))

  return (
    <div>
      <div className="max-h-56 overflow-y-auto p-2" onWheel={(e) => e.stopPropagation()}>
        {watchers.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground/60">No watchers yet</p>
        ) : (
          <div className="space-y-2">
            {watchers.map((w) => (
              <div key={w.principalId} className="group flex items-center gap-2">
                <Avatar
                  src={w.avatarUrl}
                  name={w.displayName ?? 'Watcher'}
                  className="size-6 shrink-0 text-xs"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {w.displayName ?? 'Unnamed'}
                  </p>
                </div>
                {isMuted(w.mutedUntil) && (
                  <BellSlashIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                )}
                <Badge size="sm" variant="subtle" shape="pill">
                  {REASON_LABEL[w.reason]}
                </Badge>
                <button
                  type="button"
                  onClick={() =>
                    removeWatcher.mutate(
                      { ticketId, principalId: w.principalId },
                      { onError: () => toast.error('Failed to remove watcher') }
                    )
                  }
                  disabled={
                    removeWatcher.isPending &&
                    removeWatcher.variables?.principalId === w.principalId
                  }
                  className="hidden size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                  aria-label="Remove watcher"
                >
                  <XMarkIcon className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t border-border/30 p-2">
        <Select
          value=""
          disabled={addWatcher.isPending || candidates.length === 0}
          onValueChange={(principalId) =>
            addWatcher.mutate(
              { ticketId, principalId: principalId as PrincipalId },
              { onError: () => toast.error('Failed to add watcher') }
            )
          }
        >
          <SelectTrigger size="sm" className="w-full">
            <PlusIcon className="size-3.5 shrink-0" />
            <SelectValue
              placeholder={candidates.length === 0 ? 'No more teammates' : 'Add watcher…'}
            />
          </SelectTrigger>
          <SelectContent className="max-h-56">
            {candidates.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                <Avatar src={m.image} name={m.name ?? m.email} className="size-5 text-xs" />
                <span className="truncate">{m.name ?? m.email ?? 'Unnamed'}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
