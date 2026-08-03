import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import type { ConversationId } from '@quackback/ids'
import { getMyConversationsFn } from '@/lib/server/functions/chat'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { TimeAgo } from '@/components/ui/time-ago'

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  pending: 'Awaiting you',
  closed: 'Closed',
}

/**
 * List of the visitor's earlier conversations (excludes the active one, which
 * the resume card handles); tapping a row opens that thread via onSelect.
 * Surfaces history after an anonymous visitor identifies and their prior
 * threads merge onto the account (P2.4). Renders nothing when there's no
 * prior history.
 */
export function WidgetConversationHistory({
  activeId,
  onSelect,
}: {
  activeId?: ConversationId | null
  onSelect: (id: ConversationId) => void
}) {
  const { data } = useQuery({
    queryKey: ['widget', 'my-conversations'],
    // Forward the widget Bearer token, or token-authed visitors fail the
    // server-side hasAuthCredentials() guard and always get an empty list.
    queryFn: () =>
      getMyConversationsFn({ data: { surface: 'widget' }, headers: getWidgetAuthHeaders() }),
    staleTime: 30_000,
  })

  const prior = (data?.conversations ?? []).filter((c) => c.id !== activeId)
  if (prior.length === 0) return null

  return (
    <div className="mt-3">
      <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
        <FormattedMessage id="widget.messages.history" defaultMessage="Previous conversations" />
      </p>
      <ul className="flex flex-col gap-1">
        {prior.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2 text-start transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                  {c.subject || c.lastMessagePreview || 'Conversation'}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {STATUS_LABEL[c.status] ?? c.status} · <TimeAgo date={c.lastMessageAt} />
                </span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/50 rtl:rotate-180" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
