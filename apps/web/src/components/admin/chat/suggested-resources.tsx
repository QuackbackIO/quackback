/**
 * Agent-only "Suggested resources" panel for the support inbox.
 *
 * Surfaces relevant help-center articles and feedback posts that match the
 * visitor's recent messages so the agent can share them directly into the
 * conversation thread. The panel lives ONLY in the admin inbox — it is
 * inherently agent-only and must never be rendered in the widget.
 *
 * Trigger: recomputes (debounced ~1.5 s) whenever the latest inbound visitor
 * message id changes, and on a manual Refresh. Results are cached per
 * (conversationId, visitorMessageId) so re-renders don't refetch.
 */
import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowPathIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
import { suggestResourcesFn } from '@/lib/server/functions/assist'
import { sharePostFn, shareArticleFn } from '@/lib/server/functions/chat'
import type { AssistResource } from '@/lib/server/domains/assist/assist-search'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { Spinner } from '@/components/shared/spinner'
import { cn } from '@/lib/shared/utils'

export function SuggestedResources({
  conversationId,
  latestVisitorMessageId,
}: {
  conversationId: ConversationId
  /** Id of the most-recent visitor message; changes trigger a debounced refetch. */
  latestVisitorMessageId: string | null
}) {
  const [expanded, setExpanded] = useState(true)
  // Debounce the trigger: only re-query after the message id has settled for
  // 1.5 s, so rapid successive messages don't hammer the retriever.
  const debouncedMsgId = useDebouncedValue(latestVisitorMessageId, 1500)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'assist', 'resources', conversationId, debouncedMsgId],
    queryFn: () => suggestResourcesFn({ data: { conversationId } }),
    enabled: !!debouncedMsgId,
    // Cache per (conversation, visitor message) for 5 min so re-renders and
    // tab switches don't re-fetch; the manual Refresh always bypasses stale.
    staleTime: 5 * 60 * 1000,
  })

  const shareMutation = useMutation({
    mutationFn: (resource: AssistResource) =>
      resource.type === 'post'
        ? sharePostFn({ data: { conversationId, postId: resource.id } })
        : shareArticleFn({ data: { conversationId, articleSlug: resource.id } }),
    onSuccess: () => toast.success('Shared in chat'),
    onError: () => toast.error('Failed to share resource'),
  })

  const resources = data ?? []

  return (
    <div className="border-t border-border/30">
      {/* Section header */}
      <div className="flex items-center gap-1 px-3 py-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? (
            <ChevronDownIcon className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRightIcon className="h-3 w-3 shrink-0" />
          )}
          <SparklesIcon className="h-3 w-3 shrink-0" />
          <span>Suggested resources</span>
        </button>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 transition-colors"
          aria-label="Refresh suggested resources"
        >
          <ArrowPathIcon className={cn('h-3 w-3', isFetching && 'animate-spin')} />
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div className="px-3 pb-2">
          {isFetching && resources.length === 0 ? (
            <div className="flex justify-center py-2">
              <Spinner size="sm" />
            </div>
          ) : resources.length === 0 && !!debouncedMsgId ? (
            <p className="py-1.5 text-center text-[11px] text-muted-foreground">
              No matching resources
            </p>
          ) : (
            <div className="space-y-0.5">
              {resources.map((r) => (
                <div
                  key={`${r.type}:${r.id}`}
                  className="group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/50 transition-colors"
                >
                  <span
                    className={cn(
                      'mt-px shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
                      r.type === 'article'
                        ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                        : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                    )}
                  >
                    {r.type === 'article' ? 'Article' : 'Post'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-[11px] font-medium text-foreground/90">
                      {r.title}
                    </p>
                    {r.snippet && (
                      <p className="line-clamp-2 text-[10px] text-muted-foreground">{r.snippet}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => shareMutation.mutate(r)}
                    disabled={shareMutation.isPending}
                    className="mt-px shrink-0 rounded border border-border/40 bg-background px-1.5 py-px text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-40 group-hover:opacity-100"
                  >
                    Share
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
