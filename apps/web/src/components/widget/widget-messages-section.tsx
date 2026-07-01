import { FormattedMessage } from 'react-intl'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import type { ConversationId } from '@quackback/ids'
import { chatAvailable } from '@/lib/shared/conversation/presence'
import { useConversationSummary } from './use-chat-summary'
import { WidgetResumeCard } from './widget-resume-card'
import { WidgetConversationHistory } from './widget-conversation-history'
import { ConversationPresenceBadge } from '@/components/shared/chat/chat-presence-badge'

interface WidgetMessagesSectionProps {
  /** Open a conversation: an id opens that thread, 'new' starts a fresh one,
   *  undefined opens the visitor's active/most-recent thread. */
  onOpenChat: (target?: ConversationId | 'new') => void
}

/**
 * The "Messages" half of the combined support surface: a resume card for the
 * most-recent thread, the tappable list of previous threads, and an always-on
 * "New conversation" entry so a visitor can start a thread even with one open.
 */
export function WidgetMessagesSection({ onOpenChat }: WidgetMessagesSectionProps) {
  const { conversation, teamName, agentsOnline, withinOfficeHours } = useConversationSummary(true)
  const available = chatAvailable(agentsOnline, withinOfficeHours)

  return (
    <div className="mt-4 border-t border-border/40 pt-3">
      <p className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">
        <FormattedMessage id="widget.messages.heading" defaultMessage="Messages" />
      </p>

      {conversation && (
        <div className="mb-2">
          <WidgetResumeCard
            conversation={conversation}
            teamName={teamName}
            agentsOnline={agentsOnline}
            onClick={() => onOpenChat(conversation.id)}
          />
        </div>
      )}

      <WidgetConversationHistory activeId={conversation?.id} onSelect={(id) => onOpenChat(id)} />

      {/* Always available — Intercom-style: start a new thread anytime. */}
      <button
        type="button"
        onClick={() => onOpenChat('new')}
        className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2.5 text-start transition-colors hover:bg-muted/40"
      >
        <ChatBubbleLeftRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">
            {conversation ? (
              <FormattedMessage id="widget.messages.new" defaultMessage="New conversation" />
            ) : (
              <FormattedMessage id="widget.messages.start" defaultMessage="Send us a message" />
            )}
          </span>
          <ConversationPresenceBadge available={available} className="mt-0.5" />
        </span>
      </button>
    </div>
  )
}
