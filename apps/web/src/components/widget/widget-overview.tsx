import type { ComponentType } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { widgetTranslationFor, type WidgetTranslations } from '@/lib/shared/widget/translations'
import { motion, useReducedMotion } from 'framer-motion'
import {
  LightBulbIcon,
  ChatBubbleLeftRightIcon,
  MagnifyingGlassIcon,
  ChevronRightIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/shared/utils'
import type { WidgetHomeCard, WidgetHomeConfig } from '@/lib/shared/types/settings'
import { DEFAULT_WIDGET_HOME_CARDS } from '@/lib/shared/types/settings'
import { heroBackdropStyle } from '@/lib/shared/widget/hero-style'
import { cardVisibleToVisitor } from '@/lib/shared/widget/home-cards'
import { useConversationSummary } from './use-messenger-summary'
import { useWidgetAuth } from './widget-auth-provider'
import { firstNameOf } from '@/lib/shared/conversation/personalize'
import { WidgetResumeCard } from './widget-resume-card'
import { WidgetChangelogTeaser } from './widget-changelog-teaser'
import { type EnabledTabs } from './widget-nav'

/** Canonical Home card chrome — every card shares it so the surface reads as
 *  one system. Hovers use the SOLID accent token: a translucent hover over the
 *  hero backdrop would make a card see-through (reads as an opacity dip). */
const CARD = 'rounded-2xl border border-border/60 bg-card'
const CARD_INTERACTIVE = `${CARD} transition-colors hover:bg-accent`

interface WidgetOverviewProps {
  tabs: EnabledTabs
  /** Admin-customised Home content (greeting, hero style, ordered cards). */
  home: WidgetHomeConfig | null
  /** Per-locale copy overrides; the greeting/subtitle resolve against the
   *  visitor's locale before the base `home` copy. */
  translations?: WidgetTranslations
  /** AI-assistant display identity; personalises the conversation card when set. */
  assistant: { name: string; avatarUrl: string | null } | null
  /** Teammate avatars — the facepile on the ask-a-question card. */
  team: { name: string; avatarUrl: string | null }[]
  /** Top help articles for the search card (SSR'd by the loader). */
  topArticles: { slug: string; title: string }[]
  /** Open the feedback feed (Suggest a feature). */
  onLeaveFeedback: () => void
  /** Open the help articles surface. */
  onOpenHelp: () => void
  /** Open a single help article from the search card. */
  onOpenHelpArticle: (slug: string) => void
  /** Start a brand-new conversation (opens the messenger composer). */
  onStartConversation: () => void
  /** Resume an in-flight conversation (opens the messenger thread directly). */
  onResumeMessenger: () => void
  /** Open the full changelog. */
  onSeeChangelog: () => void
  /** Open a single changelog entry from the teaser. */
  onOpenChangelogEntry: (entryId: string) => void
}

/**
 * Fill a greeting template's `{name}` placeholder with the visitor's first name,
 * gracefully dropping the token (and any doubled spaces) when the name is unknown.
 */
function fillGreeting(template: string, firstName: string | null | undefined): string {
  return template
    .replace(/\{name\}/g, firstName ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Aggregated Home — greets the visitor (admin greeting/subtitle over the shell's
 * hero backdrop), then the admin-ordered card list: ask-a-question (with a
 * teammate/assistant facepile), a labeled recent-message card, a search card
 * with top articles, the latest-update teaser, and external links. Everything
 * on the first paint is loader-fed (SSR) so nothing pops in; only a
 * Bearer-token visitor's recent conversation can arrive after mount, fading in.
 */
export function WidgetOverview({
  tabs,
  home,
  translations,
  assistant,
  team,
  topArticles,
  onLeaveFeedback,
  onOpenHelp,
  onOpenHelpArticle,
  onStartConversation,
  onResumeMessenger,
  onSeeChangelog,
  onOpenChangelogEntry,
}: WidgetOverviewProps) {
  const { user, isIdentified } = useWidgetAuth()
  // Resolve the customer-facing greeting/subtitle for the visitor's locale,
  // falling back to the base admin copy.
  const { locale } = useIntl()
  const localized = widgetTranslationFor(translations, locale)
  const greeting = localized.greeting || home?.greeting
  const subtitle = localized.subtitle || home?.subtitle
  const firstName = firstNameOf(user?.name)
  const reduceMotion = useReducedMotion()

  // A recent-conversation resume card is a messenger concept — only fetched/shown
  // when the Messages surface is enabled.
  const { conversation, teamName, agentsOnline } = useConversationSummary(!!tabs.messages)

  // The hero backdrop itself renders in the shell (it fills the whole panel,
  // header row included); here we only adapt the greeting typography and
  // spacing to whether a backdrop is active.
  const overImage = home?.headerStyle === 'image' && !!home.heroImageUrl
  const heroActive = overImage || heroBackdropStyle(home) !== null
  // A blank custom title/subtitle means "unset" — the admin editor persists an
  // empty string when a field is cleared, so normalise it back to the built-in
  // default copy rather than rendering an empty card.
  const cards = (home?.cards?.length ? home.cards : DEFAULT_WIDGET_HOME_CARDS)
    .filter((c) => c.enabled !== false)
    .filter((c) => cardVisibleToVisitor(c.audience, isIdentified))
    .map((c) => ({
      ...c,
      title: c.title?.trim() ? c.title : undefined,
      subtitle: c.subtitle?.trim() ? c.subtitle : undefined,
    }))

  /** Render one Home card by type; null when its surface is disabled. */
  function renderCard(card: WidgetHomeCard) {
    switch (card.type) {
      case 'feedback':
        if (!tabs.feedback) return null
        return (
          <ActionCard
            icon={LightBulbIcon}
            onClick={onLeaveFeedback}
            title={
              card.title ?? (
                <FormattedMessage
                  id="widget.launcher.action.feedback"
                  defaultMessage="Suggest a feature"
                />
              )
            }
            subtitle={
              card.subtitle ?? (
                <FormattedMessage
                  id="widget.launcher.action.feedback.sub"
                  defaultMessage="Share an idea or vote on others"
                />
              )
            }
          />
        )
      case 'new_conversation': {
        if (!tabs.messages) return null
        // Facepile: the assistant fronting, flanked by real teammates.
        const faces: { name: string; avatarUrl: string | null }[] = [
          ...(assistant ? [{ name: assistant.name, avatarUrl: assistant.avatarUrl }] : []),
          ...team.slice(0, assistant ? 2 : 3),
        ]
        return (
          <button
            type="button"
            onClick={onStartConversation}
            className={cn(
              'group w-full flex items-center gap-3 px-3.5 py-3.5 text-start',
              CARD_INTERACTIVE
            )}
          >
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                {card.title ?? (
                  <FormattedMessage
                    id="widget.launcher.action.messages"
                    defaultMessage="Ask a question"
                  />
                )}
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {card.subtitle ??
                  (assistant ? (
                    <FormattedMessage
                      id="widget.launcher.action.messages.sub.assistant"
                      defaultMessage="{name} and the team can help"
                      values={{ name: assistant.name }}
                    />
                  ) : (
                    <FormattedMessage
                      id="widget.launcher.action.messages.sub"
                      defaultMessage="Chat with our team"
                    />
                  ))}
              </span>
            </span>
            {faces.length > 0 ? (
              <span className="flex items-center -space-x-2 shrink-0" aria-hidden>
                {faces.map((f, i) => (
                  <Avatar
                    key={`${f.name}-${i}`}
                    src={f.avatarUrl}
                    name={f.name}
                    className="size-7 text-xs ring-2 ring-card"
                  />
                ))}
              </span>
            ) : (
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-muted-foreground/50 shrink-0" />
            )}
          </button>
        )
      }
      case 'article_search':
        if (!tabs.help) return null
        if (topArticles.length === 0) {
          return (
            <ActionCard
              icon={MagnifyingGlassIcon}
              onClick={onOpenHelp}
              title={
                card.title ?? (
                  <FormattedMessage id="widget.launcher.action.help" defaultMessage="Get help" />
                )
              }
              subtitle={
                card.subtitle ?? (
                  <FormattedMessage
                    id="widget.launcher.action.help.sub.helpOnly"
                    defaultMessage="Search for answers"
                  />
                )
              }
            />
          )
        }
        return (
          <div className={cn('p-2', CARD)}>
            <button
              type="button"
              onClick={onOpenHelp}
              className="flex w-full items-center justify-between rounded-xl bg-muted px-3 py-2.5 transition-colors hover:bg-accent"
            >
              <span className="text-sm font-semibold text-foreground">
                {card.title ?? (
                  <FormattedMessage
                    id="widget.launcher.searchHelp"
                    defaultMessage="Search for help"
                  />
                )}
              </span>
              <MagnifyingGlassIcon className="w-4 h-4 text-muted-foreground" />
            </button>
            <ul className="mt-1">
              {topArticles.map((a) => (
                <li key={a.slug}>
                  <button
                    type="button"
                    onClick={() => onOpenHelpArticle(a.slug)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start transition-colors hover:bg-accent"
                  >
                    <span className="truncate text-sm text-foreground/90">{a.title}</span>
                    <ChevronRightIcon className="w-4 h-4 shrink-0 text-muted-foreground/50 rtl:rotate-180" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      case 'latest_updates':
        if (!tabs.changelog) return null
        return (
          <WidgetChangelogTeaser onOpenEntry={onOpenChangelogEntry} onSeeAll={onSeeChangelog} />
        )
      case 'link':
        if (!card.url) return null
        return <QuickLinkCard title={card.title} subtitle={card.subtitle} url={card.url} />
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col h-full">
      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0 h-full">
        <div className="flex flex-col gap-4 pb-4">
          <header className={cn('relative space-y-1 px-4', heroActive ? 'pt-6 pb-4' : 'pt-6')}>
            <h1
              className={cn(
                'font-semibold leading-tight',
                heroActive ? 'text-2xl' : 'text-xl',
                overImage ? 'text-white drop-shadow-sm' : 'text-foreground'
              )}
            >
              {greeting ? (
                fillGreeting(greeting, firstName)
              ) : firstName ? (
                <FormattedMessage
                  id="widget.launcher.greeting.named"
                  defaultMessage="Hi, {name} 👋"
                  values={{ name: firstName }}
                />
              ) : (
                <FormattedMessage id="widget.launcher.greeting" defaultMessage="Hi there 👋" />
              )}
            </h1>
            <p
              className={cn(
                'text-sm',
                overImage ? 'text-white/85 drop-shadow-sm' : 'text-muted-foreground'
              )}
            >
              {subtitle ? (
                subtitle
              ) : (
                <FormattedMessage id="widget.launcher.subtitle" defaultMessage="How can we help?" />
              )}
            </p>
          </header>

          <div className="flex flex-col gap-4 px-4">
            {/* Cards stagger in gently under the view's own entrance. */}
            <motion.div
              className="flex flex-col gap-2.5"
              initial={reduceMotion ? false : 'hidden'}
              animate="visible"
              variants={{ visible: { transition: { staggerChildren: 0.045 } } }}
            >
              {conversation && (
                // For Bearer-token visitors this can arrive after mount (SSR
                // can't see their token); fade it in rather than popping.
                <motion.div
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                >
                  <div className={cn('p-3', CARD)}>
                    <p className="mb-2 text-sm font-semibold text-foreground">
                      <FormattedMessage
                        id="widget.launcher.recentMessage"
                        defaultMessage="Recent message"
                      />
                    </p>
                    <WidgetResumeCard
                      bare
                      conversation={conversation}
                      teamName={assistant?.name ?? teamName}
                      agentsOnline={agentsOnline}
                      onClick={onResumeMessenger}
                    />
                  </div>
                </motion.div>
              )}

              {cards.map((card) => {
                const node = renderCard(card)
                if (!node) return null
                return (
                  <motion.div
                    key={card.id}
                    variants={{
                      hidden: { opacity: 0, y: 8 },
                      visible: {
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.25, ease: [0.32, 0.72, 0, 1] },
                      },
                    }}
                  >
                    {node}
                  </motion.div>
                )
              })}
            </motion.div>
          </div>
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
}: {
  icon: ComponentType<{ className?: string }>
  title: React.ReactNode
  subtitle?: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full flex items-center gap-3 px-3.5 py-3.5 text-start',
        CARD_INTERACTIVE
      )}
    >
      <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0 bg-muted text-muted-foreground">
        <Icon className="w-5 h-5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        {subtitle && <span className="block text-xs text-muted-foreground mt-0.5">{subtitle}</span>}
      </span>
      <ChevronRightIcon className="w-4 h-4 text-muted-foreground/50 shrink-0 rtl:rotate-180" />
    </button>
  )
}

/** An admin-defined quick link — opens an external URL in a new tab. */
function QuickLinkCard({
  title,
  subtitle,
  url,
}: {
  title?: string
  subtitle?: string
  url: string
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'group w-full flex items-center gap-3 px-3.5 py-3.5 text-start',
        CARD_INTERACTIVE
      )}
    >
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-foreground">{title || url}</span>
        {subtitle && <span className="block text-xs text-muted-foreground mt-0.5">{subtitle}</span>}
      </span>
      <ArrowTopRightOnSquareIcon className="w-4 h-4 text-muted-foreground/50 shrink-0" />
    </a>
  )
}
