import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { formatDistanceToNow } from 'date-fns'
import type { ConversationId } from '@quackback/ids'
import { getMyConversationsFn } from '@/lib/server/functions/chat'

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  pending: 'Awaiting you',
  closed: 'Closed',
}

/**
 * Read-only list of the visitor's earlier conversations (excludes the active
 * one, which the resume card handles). Surfaces history after an anonymous
 * visitor identifies and their prior threads merge onto the account (P2.4).
 * Renders nothing when there's no prior history.
 */
export function WidgetConversationHistory({ activeId }: { activeId?: ConversationId | null }) {
  const { data } = useQuery({
    queryKey: ['widget', 'my-conversations'],
    queryFn: () => getMyConversationsFn(),
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
          <li
            key={c.id}
            className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-3 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-foreground">
                {c.subject || c.lastMessagePreview || 'Conversation'}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {STATUS_LABEL[c.status] ?? c.status} ·{' '}
                {formatDistanceToNow(new Date(c.lastMessageAt), { addSuffix: true })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
