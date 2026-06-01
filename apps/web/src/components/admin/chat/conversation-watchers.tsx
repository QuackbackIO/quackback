import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
import {
  getConversationWatchersFn,
  addConversationWatcherFn,
  removeConversationWatcherFn,
} from '@/lib/server/functions/chat'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/shared/utils'

/**
 * Watch/unwatch a conversation + the current watcher avatars. A watcher is
 * notified of new visitor messages even when they aren't the assignee. Whether
 * the caller is watching is resolved server-side (no client principal id).
 */
export function ConversationWatchers({ conversationId }: { conversationId: ConversationId }) {
  const queryClient = useQueryClient()
  const queryKey = ['admin', 'chat', 'watchers', conversationId]
  const { data } = useQuery({
    queryKey,
    queryFn: () => getConversationWatchersFn({ data: { conversationId } }),
    staleTime: 30_000,
  })

  const refetch = () => queryClient.invalidateQueries({ queryKey })
  const watchMutation = useMutation({
    mutationFn: (watch: boolean) =>
      (watch ? addConversationWatcherFn : removeConversationWatcherFn)({
        data: { conversationId },
      }),
    onSuccess: () => void refetch(),
    onError: () => toast.error('Failed to update watch state'),
  })

  const watchers = data?.watchers ?? []
  const isWatching = data?.isWatching ?? false

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground">Watchers</p>
        <button
          type="button"
          onClick={() => watchMutation.mutate(!isWatching)}
          disabled={watchMutation.isPending}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
            isWatching ? 'text-primary hover:bg-muted' : 'text-muted-foreground hover:bg-muted'
          )}
        >
          {isWatching ? (
            <>
              <EyeSlashIcon className="h-3 w-3" /> Unwatch
            </>
          ) : (
            <>
              <EyeIcon className="h-3 w-3" /> Watch
            </>
          )}
        </button>
      </div>
      {watchers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {watchers.map((w) => (
            <Avatar
              key={w.principalId}
              src={w.avatarUrl}
              name={w.name ?? 'Agent'}
              className="size-5 text-[9px]"
            />
          ))}
        </div>
      )}
    </div>
  )
}
