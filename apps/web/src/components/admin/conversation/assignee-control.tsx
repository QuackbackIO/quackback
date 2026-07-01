import { useMutation, useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, CheckIcon, UserCircleIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
import type { ConversationAuthorDTO } from '@/lib/shared/conversation/types'
import { assignConversationFn } from '@/lib/server/functions/conversation'
import { fetchTeamMembers } from '@/lib/server/functions/admin'
import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
  const { data: members } = useQuery({
    queryKey: ['admin', 'team-members'],
    queryFn: () => fetchTeamMembers(),
    staleTime: 60_000,
  })

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
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
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
          <ChevronDownIcon className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        <DropdownMenuItem onClick={() => mutation.mutate('me')} className="text-xs">
          Assign to me
        </DropdownMenuItem>
        {assignedAgent && (
          <DropdownMenuItem onClick={() => mutation.mutate(null)} className="text-xs">
            Unassign
          </DropdownMenuItem>
        )}
        {members && members.length > 0 && <DropdownMenuSeparator />}
        {members?.map((m) => (
          <DropdownMenuItem
            key={m.id}
            onClick={() => mutation.mutate(m.id)}
            className="flex items-center gap-2 text-xs"
          >
            <Avatar src={m.image} name={m.name ?? m.email} className="size-5 text-[9px]" />
            <span className="truncate">{m.name ?? m.email}</span>
            {assignedAgent?.principalId === m.id && (
              <CheckIcon className="ml-auto h-3.5 w-3.5 text-primary" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
