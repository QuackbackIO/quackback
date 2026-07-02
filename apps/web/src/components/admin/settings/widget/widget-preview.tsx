import { useState } from 'react'
import {
  XMarkIcon,
  MagnifyingGlassIcon,
  HomeIcon,
  LightBulbIcon,
  NewspaperIcon,
  QuestionMarkCircleIcon,
  ChatBubbleLeftRightIcon,
  ChatBubbleOvalLeftEllipsisIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Avatar } from '@/components/ui/avatar'
import type { WidgetHomeCard, WidgetHomeConfig } from '@/lib/shared/types/settings'
import { DEFAULT_WIDGET_HOME_CARDS } from '@/lib/shared/types/settings'

type PreviewTab = 'home' | 'messages' | 'feedback' | 'help' | 'changelog'

// Tab bar order + icons/labels — mirrors visibleTabs()/TAB_CONFIG in the real
// widget (components/widget/widget-nav.ts + widget-shell.tsx) so the preview
// renders the same tabs in the same order as the embedded widget.
const TAB_META: Record<PreviewTab, { icon: typeof LightBulbIcon; label: string }> = {
  home: { icon: HomeIcon, label: 'Home' },
  messages: { icon: ChatBubbleLeftRightIcon, label: 'Messages' },
  feedback: { icon: LightBulbIcon, label: 'Feedback' },
  help: { icon: QuestionMarkCircleIcon, label: 'Help' },
  changelog: { icon: NewspaperIcon, label: 'Changelog' },
}

export interface WidgetPreviewTabs {
  home?: boolean
  messenger?: boolean
  feedback?: boolean
  changelog?: boolean
  help?: boolean
}

interface WidgetPreviewProps {
  position: 'bottom-right' | 'bottom-left'
  tabs?: WidgetPreviewTabs
  /** Home customisation (greeting, hero style, cards, avatar cluster). */
  home?: WidgetHomeConfig | null
  /** Assistant identity; fronts the messages mocks when enabled. */
  assistant?: { enabled?: boolean; name?: string; avatarUrl?: string } | null
  /** Team label fallback (workspace or messenger team name). */
  teamName?: string | null
  /** Workspace logo shown top-left on the Home header. */
  logoUrl?: string | null
  /** Preview theme — 'dark' wraps the panel in the .dark token scope. */
  theme?: 'light' | 'dark'
}

/** Mirrors homeEnabled/visibleTabs from widget-nav for the preview's tab bar. */
function previewTabOrder(tabs: WidgetPreviewTabs): PreviewTab[] {
  const surfaces: PreviewTab[] = []
  if (tabs.messenger) surfaces.push('messages')
  if (tabs.feedback) surfaces.push('feedback')
  if (tabs.help) surfaces.push('help')
  if (tabs.changelog) surfaces.push('changelog')
  const homeShown = (tabs.home ?? true) && surfaces.length > 1
  return homeShown ? ['home', ...surfaces] : surfaces
}

export function WidgetPreview({
  position,
  tabs = { feedback: true, changelog: false, help: false, messenger: false },
  home,
  assistant,
  teamName,
  logoUrl,
  theme = 'light',
}: WidgetPreviewProps) {
  const [isOpen, setIsOpen] = useState(true)
  const enabledTabs = previewTabOrder(tabs)
  const showTabBar = enabledTabs.length > 1

  // Active tab is derived: honour the user's selection while it's still enabled,
  // otherwise fall back to the first enabled tab. Deriving (rather than syncing
  // via an effect) means it can never lag, drift, or loop when the enabled set
  // changes as tabs are toggled in the controls.
  const [requestedTab, setRequestedTab] = useState<PreviewTab | null>(null)
  const activeTab: PreviewTab =
    requestedTab && enabledTabs.includes(requestedTab)
      ? requestedTab
      : (enabledTabs[0] ?? 'feedback')

  const assistantName = assistant?.enabled ? assistant.name?.trim() || 'Quinn' : null
  const senderName = assistantName ?? teamName ?? 'Support'
  const senderAvatar = assistant?.enabled ? (assistant?.avatarUrl ?? null) : null

  // Full-panel hero backdrop on Home, mirroring the real shell.
  const heroImage = home?.headerStyle === 'image' ? (home.heroImageUrl ?? null) : null
  const heroActive = activeTab === 'home' && (home?.headerStyle === 'gradient' || !!heroImage)
  const overImage = activeTab === 'home' && !!heroImage

  return (
    <div className={cn('h-full', theme === 'dark' && 'dark')}>
      <div className="relative flex h-full min-h-[560px] items-center justify-center rounded-xl border border-border bg-muted/30 overflow-hidden text-foreground">
        {/* Simulated page background */}
        <PageBackdrop />

        {/* Widget panel — centered in the pane so it never feels cramped. */}
        {isOpen && (
          <div className="relative z-10 w-[340px] h-[600px] max-h-[calc(100%-5rem)] rounded-2xl border border-border bg-background shadow-2xl overflow-hidden flex flex-col">
            {/* Hero backdrop fills the panel behind the header + body. */}
            {heroActive && (
              <div className="absolute inset-0 z-0" aria-hidden>
                {heroImage ? (
                  <>
                    <img src={heroImage} alt="" className="h-full w-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-background" />
                  </>
                ) : (
                  <div className="h-full w-full bg-gradient-to-b from-primary/30 via-primary/10 to-transparent" />
                )}
              </div>
            )}

            {/* Header: home shows logo + teammate cluster; other tabs a title. */}
            <div className="relative z-10 flex items-center justify-between px-3 pt-2.5 pb-1 shrink-0">
              <span className="flex items-center">
                {activeTab === 'home' && logoUrl && (
                  <img src={logoUrl} alt="" className="h-5 max-w-[90px] object-contain" />
                )}
              </span>
              {activeTab !== 'home' && (
                <p className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs font-semibold text-foreground">
                  {activeTab === 'feedback'
                    ? 'Share your ideas'
                    : activeTab === 'help'
                      ? 'Help & Support'
                      : activeTab === 'messages'
                        ? 'Messages'
                        : "What's new"}
                </p>
              )}
              <span className="flex items-center gap-1.5">
                {activeTab === 'home' && (home?.showTeamAvatars ?? true) && (
                  <span className="flex items-center -space-x-1.5">
                    {['A', 'J', 'M'].map((n) => (
                      <span
                        key={n}
                        className="flex size-6 items-center justify-center rounded-full bg-primary/20 text-[8px] font-semibold text-primary ring-2 ring-background"
                      >
                        {n}
                      </span>
                    ))}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className={cn(
                    'w-6 h-6 flex items-center justify-center rounded-md transition-colors shrink-0',
                    overImage ? 'hover:bg-white/20' : 'hover:bg-muted'
                  )}
                >
                  <XMarkIcon
                    className={cn(
                      'w-3.5 h-3.5',
                      overImage ? 'text-white' : 'text-muted-foreground'
                    )}
                  />
                </button>
              </span>
            </div>

            {/* Content area */}
            <div className="relative z-10 flex-1 overflow-hidden">
              {activeTab === 'home' ? (
                <MockHome
                  home={home}
                  tabs={tabs}
                  assistantName={assistantName}
                  heroActive={heroActive}
                  overImage={overImage}
                />
              ) : activeTab === 'messages' ? (
                <MockMessages senderName={senderName} senderAvatar={senderAvatar} />
              ) : activeTab === 'feedback' ? (
                <MockFeedback />
              ) : activeTab === 'help' ? (
                <MockHelp />
              ) : (
                <MockChangelog teamName={teamName} />
              )}
            </div>

            {/* Footer: Tab bar + Powered by */}
            <div className="relative z-10 border-t border-border shrink-0 bg-background">
              {showTabBar && (
                <div className="flex">
                  {enabledTabs.map((t) => {
                    const { icon: Icon, label } = TAB_META[t]
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-label={`${label} tab`}
                        onClick={() => setRequestedTab(t)}
                        className={cn(
                          'flex-1 flex flex-col items-center gap-0.5 py-1.5 transition-colors',
                          activeTab === t
                            ? 'text-primary'
                            : 'text-muted-foreground/60 hover:text-muted-foreground'
                        )}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-[9px] font-medium">{label}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              <div className={cn('text-center', showTabBar ? 'pb-1' : 'py-1.5')}>
                <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground/60">
                  <img src="/logo.png" alt="" width={10} height={10} className="opacity-60" />
                  Powered by Quackback
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Trigger button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'absolute bottom-4 flex items-center justify-center w-10 h-10 rounded-full',
            'bg-primary text-primary-foreground shadow-md',
            'transition-all hover:shadow-lg hover:-translate-y-0.5',
            position === 'bottom-left' ? 'left-4' : 'right-4'
          )}
        >
          <ChatBubbleOvalLeftEllipsisIcon className="w-5 h-5" />
        </button>
      </div>
    </div>
  )
}

/** Home mock: greeting hero + the ordered card list, faithful to WidgetOverview. */
function MockHome({
  home,
  tabs,
  assistantName,
  heroActive,
  overImage,
}: {
  home?: WidgetHomeConfig | null
  tabs: WidgetPreviewTabs
  assistantName: string | null
  heroActive: boolean
  overImage: boolean
}) {
  const greeting = (home?.greeting || 'Hi there 👋').replace(/\{name\}/g, 'there')
  const subtitle = home?.subtitle || 'How can we help?'
  const cards = (home?.cards?.length ? home.cards : DEFAULT_WIDGET_HOME_CARDS).filter(
    (c) => c.enabled !== false
  )

  function renderCard(card: WidgetHomeCard) {
    switch (card.type) {
      case 'feedback':
        if (!tabs.feedback) return null
        return (
          <MockActionCard
            key={card.id}
            primary
            icon={LightBulbIcon}
            title={card.title || 'Suggest a feature'}
            subtitle={card.subtitle || 'Share an idea or vote on others'}
          />
        )
      case 'new_conversation':
        if (!tabs.messenger) return null
        return (
          <MockActionCard
            key={card.id}
            icon={ChatBubbleLeftRightIcon}
            title={card.title || 'Ask a question'}
            subtitle={
              card.subtitle ||
              (assistantName ? `${assistantName} and the team can help` : 'Chat with our team')
            }
          />
        )
      case 'article_search':
        if (!tabs.help) return null
        return (
          <MockActionCard
            key={card.id}
            icon={MagnifyingGlassIcon}
            title={card.title || 'Get help'}
            subtitle={card.subtitle || 'Search for answers'}
          />
        )
      case 'latest_updates':
        if (!tabs.changelog) return null
        return (
          <div key={card.id} className="rounded-lg border border-border/60 bg-card px-2.5 py-2">
            <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/60">
              What&apos;s new
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-foreground line-clamp-1">
              Interactive setup guides
            </p>
            <p className="text-[9px] text-muted-foreground/70 line-clamp-1">
              Redesigned developer settings with live examples...
            </p>
          </div>
        )
      case 'link':
        return (
          <div
            key={card.id}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-foreground truncate">
                {card.title || card.url || 'Link'}
              </span>
              {card.subtitle && (
                <span className="block text-[9px] text-muted-foreground truncate">
                  {card.subtitle}
                </span>
              )}
            </span>
            <ArrowTopRightOnSquareIcon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="h-full overflow-hidden">
      <div className={cn('px-3 pb-2', heroActive ? 'pt-6' : 'pt-2')}>
        <p
          className={cn(
            'font-semibold leading-tight',
            heroActive ? 'text-lg' : 'text-base',
            overImage ? 'text-white drop-shadow-sm' : 'text-foreground'
          )}
        >
          {greeting}
        </p>
        <p
          className={cn(
            'text-[11px] mt-0.5',
            overImage ? 'text-white/85 drop-shadow-sm' : 'text-muted-foreground'
          )}
        >
          {subtitle}
        </p>
      </div>
      <div className="flex flex-col gap-1.5 px-3">{cards.map(renderCard)}</div>
    </div>
  )
}

function MockActionCard({
  icon: Icon,
  title,
  subtitle,
  primary = false,
}: {
  icon: typeof LightBulbIcon
  title: string
  subtitle?: string
  primary?: boolean
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-2',
        primary ? 'bg-primary/10 border-primary/30' : 'bg-card border-border/60'
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center w-6 h-6 rounded-md shrink-0',
          primary ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-medium text-foreground truncate">{title}</span>
        {subtitle && (
          <span className="block text-[9px] text-muted-foreground truncate">{subtitle}</span>
        )}
      </span>
      <ChevronRightIcon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
    </div>
  )
}

/** Messages mock: the uniform conversation list + the pinned ask pill. */
function MockMessages({
  senderName,
  senderAvatar,
}: {
  senderName: string
  senderAvatar: string | null
}) {
  const rows = [
    { preview: 'Thanks for reaching out! If you have any more questions...', time: '2h' },
    { preview: 'Great question! You can configure that under Settings...', time: '3d' },
    { preview: `Hi there 👋 What would you like help with?`, time: '5d' },
  ]
  return (
    <div className="relative flex h-full flex-col">
      <ul className="px-2.5 pt-1">
        {rows.map((r, i) => (
          <li key={i} className="border-b border-border/40 last:border-b-0">
            <div className="flex items-center gap-2 px-1 py-2">
              <Avatar src={senderAvatar} name={senderName} className="size-7 shrink-0 text-[9px]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-foreground">
                    {senderName}
                  </span>
                  <span className="shrink-0 text-[9px] text-muted-foreground/60">{r.time}</span>
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {r.preview}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground shadow-lg">
          Ask a question
          <ChatBubbleOvalLeftEllipsisIcon className="w-3 h-3" />
        </span>
      </div>
    </div>
  )
}

function MockFeedback() {
  return (
    <div className="px-3 pt-1">
      <div className="relative mb-1.5">
        <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
        <div className="w-full pl-6 pr-2 py-1.5 text-[10px] rounded-lg border border-border bg-muted/30 text-muted-foreground/60">
          Search ideas...
        </div>
      </div>
      <p className="text-[8px] font-medium text-muted-foreground/60 uppercase tracking-wide px-0.5 py-1">
        Popular ideas
      </p>
      <div className="space-y-0.5">
        <MockPost title="Add dark mode support" votes={42} voted />
        <MockPost title="Mobile app improvements" votes={28} />
        <MockPost title="Export data to CSV" votes={19} />
        <MockPost title="Keyboard shortcuts" votes={14} voted />
        <MockPost title="Custom notification rules" votes={11} />
      </div>
    </div>
  )
}

/** Help mock: the single-column collections list. */
function MockHelp() {
  const collections = [
    { title: 'Getting started', desc: 'Everything you need to know to get set up.', count: 4 },
    { title: 'Account & billing', desc: 'Plans, invoices, and account management.', count: 6 },
    { title: 'Integrations', desc: 'Connect your favourite tools.', count: 3 },
    { title: 'Troubleshooting', desc: 'Fixes for common issues.', count: 5 },
  ]
  return (
    <div className="px-3 pt-1">
      <div className="relative mb-1.5">
        <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
        <div className="w-full pl-6 pr-2 py-1.5 text-[10px] rounded-lg border border-border bg-muted/30 text-muted-foreground/60">
          Search help articles...
        </div>
      </div>
      <p className="px-0.5 py-1 text-[11px] font-semibold text-foreground">
        {collections.length} collections
      </p>
      <ul>
        {collections.map((c) => (
          <li key={c.title} className="border-b border-border/40 last:border-b-0">
            <div className="flex items-center gap-2 px-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold text-foreground">{c.title}</span>
                <span className="block text-[9px] text-muted-foreground/70 line-clamp-1">
                  {c.desc}
                </span>
                <span className="block text-[8px] text-muted-foreground/50 mt-0.5">
                  {c.count} articles
                </span>
              </span>
              <ChevronRightIcon className="w-3 h-3 text-muted-foreground/40 shrink-0" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MockChangelog({ teamName }: { teamName?: string | null }) {
  return (
    <div className="px-3 pt-1">
      <p className="px-0.5 text-[12px] font-semibold text-foreground">Latest</p>
      {teamName && <p className="px-0.5 text-[9px] text-muted-foreground">From {teamName}</p>}
      <div className="mt-1.5 space-y-1.5">
        <MockChangelogEntry
          title="Interactive setup guides"
          date="Mar 7"
          excerpt="Redesigned developer settings with live code examples..."
        />
        <MockChangelogEntry
          title="Capture feedback from Slack"
          date="Mar 1"
          excerpt="Forward messages or monitor channels automatically..."
        />
        <MockChangelogEntry
          title="AI duplicate detection"
          date="Feb 25"
          excerpt="Automatically find and merge duplicate feedback..."
        />
      </div>
    </div>
  )
}

function MockPost({
  title,
  votes,
  voted = false,
}: {
  title: string
  votes: number
  voted?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg hover:bg-muted/30 transition-colors px-1 py-1">
      <div
        className={cn(
          'flex flex-col items-center justify-center shrink-0 w-7 h-7 rounded-md border text-center',
          voted
            ? 'text-primary border-primary/60 bg-primary/15'
            : 'bg-muted/30 text-muted-foreground border-border/50'
        )}
      >
        <ChevronUpIcon className={cn('h-2.5 w-2.5', voted && 'text-primary')} />
        <span
          className={cn(
            'text-[8px] font-semibold leading-none',
            voted ? 'text-primary' : 'text-foreground'
          )}
        >
          {votes}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-medium text-foreground line-clamp-1">{title}</p>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="size-1 rounded-full bg-chart-4 shrink-0" />
          <span className="text-[7px] text-muted-foreground">In Progress</span>
        </div>
      </div>
    </div>
  )
}

function MockChangelogEntry({
  title,
  date,
  excerpt,
}: {
  title: string
  date: string
  excerpt: string
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card px-2 py-1.5">
      <p className="text-[7px] font-medium text-muted-foreground/60 uppercase tracking-wide">
        {date}
      </p>
      <p className="text-[10px] font-semibold text-foreground line-clamp-1 mt-0.5">{title}</p>
      <p className="text-[8px] text-muted-foreground/70 line-clamp-2 mt-0.5 leading-relaxed">
        {excerpt}
      </p>
    </div>
  )
}

function PageBackdrop() {
  return (
    <div className="absolute inset-0 p-4 pointer-events-none select-none opacity-40">
      {/* Nav bar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-muted-foreground/20" />
          <div className="w-16 h-2.5 rounded-full bg-muted-foreground/15" />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-12 h-2 rounded-full bg-muted-foreground/10" />
          <div className="w-12 h-2 rounded-full bg-muted-foreground/10" />
          <div className="w-12 h-2 rounded-full bg-muted-foreground/10" />
        </div>
      </div>
      {/* Hero */}
      <div className="mt-8 mb-6 space-y-2 max-w-[60%]">
        <div className="w-48 h-3 rounded-full bg-muted-foreground/15" />
        <div className="w-36 h-3 rounded-full bg-muted-foreground/10" />
        <div className="w-full h-2 rounded-full bg-muted-foreground/8 mt-3" />
        <div className="w-4/5 h-2 rounded-full bg-muted-foreground/8" />
      </div>
      {/* Content blocks */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-muted-foreground/10 p-3 space-y-2">
            <div className="w-8 h-8 rounded bg-muted-foreground/10" />
            <div className="w-full h-2 rounded-full bg-muted-foreground/10" />
            <div className="w-3/4 h-2 rounded-full bg-muted-foreground/8" />
          </div>
        ))}
      </div>
    </div>
  )
}
