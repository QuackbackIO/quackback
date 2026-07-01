import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDownIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
import type { ConversationStatus } from '@/lib/shared/conversation/types'
import { setConversationStatusFn } from '@/lib/server/functions/conversation'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const STATUSES: ConversationStatus[] = ['open', 'pending', 'closed']

/**
 * A 3-state conversation status control (open / pending / closed). Used in the
 * detail panel and in the thread header below the panel breakpoint, so the full
 * status set is settable at every width (not just open↔closed).
 */
export function StatusControl({
  conversationId,
  status,
  onChanged,
}: {
  conversationId: ConversationId
  status: ConversationStatus
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const mut = useMutation({
    mutationFn: (next: ConversationStatus) =>
      setConversationStatusFn({ data: { conversationId, status: next } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'inbox', 'thread', conversationId] })
      onChanged()
    },
    onError: () => toast.error('Failed to update status'),
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={mut.isPending}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium capitalize text-foreground hover:bg-muted disabled:opacity-50"
        >
          {status}
          <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {STATUSES.map((s) => (
          <DropdownMenuItem key={s} onClick={() => mut.mutate(s)} className="text-xs capitalize">
            {s}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
