import type { ComponentType } from 'react'
import { FormattedMessage } from 'react-intl'
import { LightBulbIcon, ChatBubbleLeftRightIcon, ChevronRightIcon } from '@heroicons/react/24/solid'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/shared/utils'
import { useConversationSummary } from './use-messenger-summary'
import { useWidgetAuth } from './widget-auth-provider'
import { firstNameOf } from '@/lib/shared/conversation/personalize'
import { WidgetResumeCard } from './widget-resume-card'
import { WidgetChangelogTeaser } from './widget-changelog-teaser'
import { type EnabledTabs, supportEnabled } from './widget-nav'

interface WidgetOverviewProps {
  tabs: EnabledTabs
  /** Open the feedback feed (Suggest a feature). */
  onLeaveFeedback: () => void
  /** Open the support surface (help articles + messages). */
  onGetHelp: () => void
  /** Resume an in-flight conversation (opens the chat thread directly). */
  onResumeChat: () => void
  /** Open the full changelog. */
  onSeeChangelog: () => void
  /** Open a single changelog entry from the teaser. */
  onOpenChangelogEntry: (entryId: string) => void
}

/**
 * Aggregated Home — greets the visitor (with live-chat presence), surfaces a
 * recent-conversation resume card, routes to each enabled surface via action
 * cards, and shows an ambient latest-changelog teaser at the bottom. Rendered
 * only when 2+ content surfaces exist (see homeEnabled in widget-nav), so it
 * never shows a single redundant card.
 */
export function WidgetOverview({
  tabs,
  onLeaveFeedback,
  onGetHelp,
  onResumeChat,
  onSeeChangelog,
  onOpenChangelogEntry,
}: WidgetOverviewProps) {
  const { user } = useWidgetAuth()
  const firstName = firstNameOf(user?.name)

  // A recent-conversation resume card is a chat concept — only fetched/shown
  // when chat is part of the support surface. Presence now lives on the support
  // surface's message CTA, not here.
  const { conversation, teamName, agentsOnline } = useConversationSummary(!!tabs.chat)

  return (
    <div className="flex flex-col h-full">
      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0 h-full">
        <div className="flex flex-col gap-4 px-4 pt-6 pb-4">
          <header className="space-y-1">
            <h1 className="text-xl font-semibold text-foreground leading-tight">
              {firstName ? (
                <FormattedMessage
                  id="widget.launcher.greeting.named"
                  defaultMessage="Hi, {name} 👋"
                  values={{ name: firstName }}
                />
              ) : (
                <FormattedMessage id="widget.launcher.greeting" defaultMessage="Hi there 👋" />
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              <FormattedMessage id="widget.launcher.subtitle" defaultMessage="How can we help?" />
            </p>
          </header>

          {conversation && (
            <WidgetResumeCard
              conversation={conversation}
              teamName={teamName}
              agentsOnline={agentsOnline}
              onClick={onResumeChat}
            />
          )}

          <div className="flex flex-col gap-2">
            {tabs.feedback && (
              <ActionCard
                primary
                icon={LightBulbIcon}
                onClick={onLeaveFeedback}
                title={
                  <FormattedMessage
                    id="widget.launcher.action.feedback"
                    defaultMessage="Suggest a feature"
                  />
                }
                subtitle={
                  <FormattedMessage
                    id="widget.launcher.action.feedback.sub"
                    defaultMessage="Share an idea or vote on others"
                  />
                }
              />
            )}

            {supportEnabled(tabs) && (
              <ActionCard
                icon={ChatBubbleLeftRightIcon}
                onClick={onGetHelp}
                title={
                  tabs.chat && !tabs.help ? (
                    <FormattedMessage
                      id="widget.launcher.action.support.messengerOnly"
                      defaultMessage="Send us a message"
                    />
                  ) : (
                    <FormattedMessage id="widget.launcher.action.help" defaultMessage="Get help" />
                  )
                }
                subtitle={
                  tabs.help && tabs.chat ? (
                    <FormattedMessage
                      id="widget.launcher.action.help.sub"
                      defaultMessage="Search answers or message us"
                    />
                  ) : tabs.help ? (
                    <FormattedMessage
                      id="widget.launcher.action.help.sub.helpOnly"
                      defaultMessage="Search for answers"
                    />
                  ) : (
                    <FormattedMessage
                      id="widget.launcher.action.help.sub.messengerOnly"
                      defaultMessage="Chat with our team"
                    />
                  )
                }
              />
            )}
          </div>

          {tabs.changelog && (
            <WidgetChangelogTeaser onOpenEntry={onOpenChangelogEntry} onSeeAll={onSeeChangelog} />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

function ActionCard({
  icon: Icon,
  title,
  subtitle,
  onClick,
  primary = false,
}: {
  icon: ComponentType<{ className?: string }>
  title: React.ReactNode
  subtitle?: React.ReactNode
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full flex items-center gap-3 rounded-xl border px-3.5 py-3 text-start transition-colors',
        primary
          ? 'bg-primary/10 border-primary/30 hover:bg-primary/15'
          : 'bg-card border-border/60 hover:bg-muted/40'
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center w-9 h-9 rounded-lg shrink-0',
          primary ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="w-5 h-5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {subtitle && <span className="block text-xs text-muted-foreground mt-0.5">{subtitle}</span>}
      </span>
      <ChevronRightIcon className="w-4 h-4 text-muted-foreground/50 shrink-0 rtl:rotate-180" />
    </button>
  )
}
