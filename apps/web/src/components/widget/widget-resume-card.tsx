import { FormattedMessage, useIntl } from 'react-intl'
import { ChevronRightIcon } from '@heroicons/react/24/outline'
import { Avatar } from '@/components/ui/avatar'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/shared/utils'
import type { ConversationDTO } from '@/lib/shared/conversation/types'

interface WidgetResumeCardProps {
  conversation: ConversationDTO
  teamName: string | null
  /** Whether an agent is reachable now — drives the presence dot. */
  agentsOnline: boolean
  /** Row-only rendering (no border/background) for embedding in a labeled card. */
  bare?: boolean
  /** Resume the conversation (opens the full messenger thread). */
  onClick: () => void
}

/**
 * One-tap return to an in-flight conversation. Presentational only — the
 * caller supplies the conversation summary. Shared by the Help Messages section
 * and (later) the Home overview, so both render an identical resume affordance.
 */
export function WidgetResumeCard({
  conversation,
  teamName,
  agentsOnline,
  bare = false,
  onClick,
}: WidgetResumeCardProps) {
  const intl = useIntl()
  const agent = conversation.assignedAgent
  const name =
    agent?.displayName ??
    teamName ??
    intl.formatMessage({ id: 'widget.messages.teamFallback', defaultMessage: 'Support' })
  const isClosed = conversation.status === 'closed'
  const showOnline = agentsOnline && !isClosed

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={intl.formatMessage(
        { id: 'widget.messages.resumeAria', defaultMessage: 'Open conversation with {name}' },
        { name }
      )}
      className={cn(
        'group w-full flex items-center gap-3 text-start transition-colors',
        bare
          ? 'rounded-xl px-2 py-1.5 hover:bg-accent'
          : 'rounded-2xl border border-border/60 bg-card px-3 py-2.5 hover:bg-accent',
        isClosed && 'opacity-70'
      )}
    >
      <div className="relative shrink-0">
        <Avatar src={agent?.avatarUrl ?? null} name={name} className="size-9 text-xs" />
        {showOnline && (
          <span
            className="absolute -bottom-0.5 -end-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
            aria-hidden
          />
        )}
      </div>
      <span className="flex-1 min-w-0">
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground truncate">{name}</span>
          <TimeAgo
            date={conversation.lastMessageAt}
            className="text-[10px] text-muted-foreground/60 shrink-0"
          />
        </span>
        <span className="block text-xs text-muted-foreground truncate">
          {conversation.lastMessagePreview ?? (
            <FormattedMessage id="widget.messages.noPreview" defaultMessage="No messages yet" />
          )}
        </span>
      </span>
      {conversation.unreadCount > 0 ? (
        <span className="shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold">
          {conversation.unreadCount}
        </span>
      ) : (
        <ChevronRightIcon className="w-4 h-4 text-muted-foreground/50 shrink-0 rtl:rotate-180" />
      )}
    </button>
  )
}
