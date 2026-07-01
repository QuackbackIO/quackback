import { useQuery } from '@tanstack/react-query'
import { BookmarkIcon } from '@heroicons/react/24/solid'
import type { ConversationId, ConversationMessageId } from '@quackback/ids'
import { listFlaggedMessagesFn } from '@/lib/server/functions/chat'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/shared/spinner'
import { cn } from '@/lib/shared/utils'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

/**
 * The middle column for the "Saved for later" view: the agent's own flagged
 * messages (newest flag first), each previewing the message and the conversation
 * it lives in. Clicking opens that conversation in the thread pane.
 */
export function SavedMessagesColumn({
  selectedConversationId,
  onSelect,
}: {
  selectedConversationId: ConversationId | null
  /** Open the conversation and deep-link the flagged message within it. */
  onSelect: (conversationId: ConversationId, messageId: ConversationMessageId) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'inbox', 'flagged'],
    queryFn: () => listFlaggedMessagesFn(),
    staleTime: 30_000,
  })
  const messages = data ?? []

  return (
    <div
      className={cn(
        'flex min-h-0 w-full shrink-0 flex-col border-r border-border/50 md:w-80',
        selectedConversationId && 'hidden md:flex'
      )}
    >
      <div className="border-b border-border/50 px-4 py-[1.1rem]">
        <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold leading-tight">
          <BookmarkIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          Saved for later
        </h2>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : messages.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing saved yet — flag a message to find it here.
          </div>
        ) : (
          messages.map((m) => (
            <button
              key={m.messageId}
              type="button"
              onClick={() => onSelect(m.conversationId, m.messageId)}
              className={cn(
                'flex w-full flex-col gap-0.5 border-b border-border/30 px-3 py-3 text-left transition-colors',
                selectedConversationId === m.conversationId ? 'bg-muted/60' : 'hover:bg-muted/30'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{m.authorName ?? 'Unknown'}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {relativeTime(m.flaggedAt)}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{m.preview}</p>
              <p className="truncate text-[10px] text-muted-foreground/60">
                in {m.conversationLabel ?? 'conversation'}
              </p>
            </button>
          ))
        )}
      </ScrollArea>
    </div>
  )
}
