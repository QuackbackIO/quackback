import { useMutation } from '@tanstack/react-query'
import { ChevronDownIcon, CheckIcon, UserCircleIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
import type { ConversationAuthorDTO } from '@/lib/shared/conversation/types'
import type { TeamMember } from '@/lib/server/domains/principals/principal.service'
import { assignConversationFn } from '@/lib/server/functions/conversation'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * The assignee option rows for a dropdown — shared by the thread assignee control
 * and the bulk-action bar so "Assign to me" / "Unassign" / member rows render
 * identically. Mirrors PriorityMenuItems.
 */
export function AssigneeMenuItems({
  members,
  selectedPrincipalId,
  showUnassign = true,
  onSelect,
}: {
  members: TeamMember[] | undefined
  /** Current assignee's principal id; that row gets a check. */
  selectedPrincipalId?: string | null
  /** Offer the Unassign row (hide it when there's nothing to unassign). */
  showUnassign?: boolean
  onSelect: (assignTo: string | null) => void
}) {
  return (
    <>
      <DropdownMenuItem onClick={() => onSelect('me')}>Assign to me</DropdownMenuItem>
      {showUnassign && <DropdownMenuItem onClick={() => onSelect(null)}>Unassign</DropdownMenuItem>}
      {members && members.length > 0 && <DropdownMenuSeparator />}
      {members?.map((m) => (
        <DropdownMenuItem
          key={m.id}
          onClick={() => onSelect(m.id)}
          className="flex items-center gap-2"
        >
          <Avatar src={m.image} name={m.name ?? m.email} className="size-5 text-[9px]" />
          <span className="truncate">{m.name ?? m.email}</span>
          {selectedPrincipalId === m.id && (
            <CheckIcon className="ml-auto h-3.5 w-3.5 text-primary" />
          )}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/** Header control to assign a conversation to any team member (or unassign). */
export function AssigneeControl({
  conversationId,
  assignedAgent,
  onChanged,
}: {
  conversationId: ConversationId
  assignedAgent: ConversationAuthorDTO | null
  onChanged?: () => void
}) {
  const { data: members } = useTeamMembers()

  const mutation = useMutation({
    // `'me'` is resolved to the caller's principal server-side; null unassigns.
    mutationFn: (assignTo: string | null) =>
      assignConversationFn({ data: { conversationId, assignTo } }),
    onSuccess: () => onChanged?.(),
    onError: () => toast.error('Failed to assign conversation'),
  })

  const label = assignedAgent ? (assignedAgent.displayName ?? 'Assigned') : 'Unassigned'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          {assignedAgent ? (
            <Avatar
              src={assignedAgent.avatarUrl}
              name={assignedAgent.displayName ?? 'Agent'}
              className="size-4 text-[8px]"
            />
          ) : (
            <UserCircleIcon className="h-4 w-4" />
          )}
          <span className="max-w-28 truncate">{label}</span>
          <ChevronDownIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        <AssigneeMenuItems
          members={members}
          selectedPrincipalId={assignedAgent?.principalId}
          showUnassign={!!assignedAgent}
          onSelect={(assignTo) => mutation.mutate(assignTo)}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
