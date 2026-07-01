import { useState } from 'react'
import {
  ChevronUpIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  LightBulbIcon,
  NewspaperIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  PaperClipIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'

type PreviewTab = 'feedback' | 'changelog' | 'help' | 'chat'

// Tab bar order + icons/labels — mirrors TAB_CONFIG in the real widget shell
// (components/widget/widget-shell.tsx) so the preview renders the same tabs in
// the same order as the embedded widget.
const TAB_ORDER: PreviewTab[] = ['feedback', 'changelog', 'help', 'chat']
const TAB_META: Record<PreviewTab, { icon: typeof LightBulbIcon; label: string }> = {
  feedback: { icon: LightBulbIcon, label: 'Feedback' },
  changelog: { icon: NewspaperIcon, label: 'Changelog' },
  help: { icon: BookOpenIcon, label: 'Help' },
  chat: { icon: ChatBubbleLeftRightIcon, label: 'Chat' },
}

interface WidgetPreviewProps {
  position: 'bottom-right' | 'bottom-left'
  tabs?: { feedback?: boolean; changelog?: boolean; help?: boolean; chat?: boolean }
  /** Chat config, surfaced so the chat view mirrors the real widget. */
  chat?: { teamName?: string; welcomeMessage?: string }
}

export function WidgetPreview({
  position,
  tabs = { feedback: true, changelog: false, help: false, chat: false },
  chat,
}: WidgetPreviewProps) {
  const [isOpen, setIsOpen] = useState(true)
  const enabledTabs = TAB_ORDER.filter((t) => Boolean(tabs[t]))
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

  return (
    <div className="relative rounded-lg border border-border bg-muted/30 overflow-hidden h-[520px]">
      {/* Simulated page background */}
      <PageBackdrop />

      {/* Widget panel (when open) */}
      {isOpen && (
        <div
          className={cn(
            'absolute bottom-14 w-[260px] rounded-xl border border-border bg-background shadow-xl overflow-hidden flex flex-col',
            position === 'bottom-left' ? 'left-3' : 'right-3'
          )}
          style={{ height: '380px' }}
        >
          {/* Header: title + close */}
          <div className="flex items-center justify-between px-2.5 pt-2 pb-0.5 shrink-0">
            <p className="text-[10px] font-semibold text-foreground px-0.5">
              {activeTab === 'feedback'
                ? 'Share your ideas'
                : activeTab === 'help'
                  ? 'Help & Support'
                  : activeTab === 'chat'
                    ? 'Chat with us'
                    : "What's new"}
            </p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="w-5 h-5 flex items-center justify-center rounded-md hover:bg-muted transition-colors shrink-0"
            >
              <XMarkIcon className="w-3 h-3 text-muted-foreground" />
            </button>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-hidden px-2.5 pb-1.5">
            {activeTab === 'feedback' ? (
              <>
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
              </>
            ) : activeTab === 'help' ? (
              <>
                <div className="relative mb-1.5">
                  <MagnifyingGlassIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
                  <div className="w-full pl-6 pr-2 py-1.5 text-[10px] rounded-lg border border-border bg-muted/30 text-muted-foreground/60">
                    Search help articles...
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <MockHelpCategory icon="📚" title="Getting started" articles={4} />
                  <MockHelpCategory icon="💳" title="Account & billing" articles={6} />
                  <MockHelpCategory icon="🔌" title="Integrations" articles={3} />
                  <MockHelpCategory icon="🔧" title="Troubleshooting" articles={5} />
                </div>
              </>
            ) : activeTab === 'chat' ? (
              <MockChatView teamName={chat?.teamName} welcomeMessage={chat?.welcomeMessage} />
            ) : (
              <div className="space-y-1 pt-0.5">
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
                <MockChangelogEntry
                  title="Better SEO for your portal"
                  date="Feb 24"
                  excerpt="Open Graph tags, sitemaps, and canonical URLs..."
                />
              </div>
            )}
          </div>

          {/* Footer: Tab bar + Powered by */}
          <div className="border-t border-border shrink-0">
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
                      <Icon className="w-3.5 h-3.5" />
                      <span className="text-[8px] font-medium">{label}</span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className={cn('text-center', showTabBar ? 'pb-0.5' : 'py-1')}>
              <span className="inline-flex items-center gap-0.5 text-[8px] text-muted-foreground/60">
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
          'absolute bottom-3 flex items-center justify-center w-8 h-8 rounded-full',
          'bg-primary text-primary-foreground shadow-md',
          'transition-all hover:shadow-lg hover:-translate-y-0.5',
          position === 'bottom-left' ? 'left-3' : 'right-3'
        )}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.913 2.658c2.075-.27 4.19-.408 6.337-.408 2.147 0 4.262.139 6.337.408 1.922.25 3.291 1.861 3.405 3.727a4.403 4.403 0 0 0-1.032-.211 50.89 50.89 0 0 0-8.42 0c-2.358.196-4.04 2.19-4.04 4.434v4.286a4.47 4.47 0 0 0 2.433 3.984L7.28 21.53A.75.75 0 0 1 6 21v-4.03a48.527 48.527 0 0 1-1.087-.128C2.905 16.58 1.5 14.833 1.5 12.862V6.638c0-1.97 1.405-3.718 3.413-3.979Z" />
          <path d="M15.75 7.5c-1.376 0-2.739.057-4.086.169C10.124 7.797 9 9.103 9 10.609v4.285c0 1.507 1.128 2.814 2.67 2.94 1.243.102 2.5.157 3.768.165l2.782 2.781a.75.75 0 0 0 1.28-.53v-2.39l.33-.026c1.542-.125 2.67-1.433 2.67-2.94v-4.286c0-1.505-1.125-2.811-2.664-2.94A49.392 49.392 0 0 0 15.75 7.5Z" />
        </svg>
      </button>
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
    <div className="rounded-lg hover:bg-muted/30 transition-colors px-1.5 py-1.5 cursor-pointer">
      <p className="text-[7px] font-medium text-muted-foreground/60 uppercase tracking-wide">
        {date}
      </p>
      <p className="text-[10px] font-medium text-foreground line-clamp-1 mt-0.5">{title}</p>
      <p className="text-[8px] text-muted-foreground/70 line-clamp-2 mt-0.5 leading-relaxed">
        {excerpt}
      </p>
    </div>
  )
}

function MockHelpCategory({
  icon,
  title,
  articles,
}: {
  icon: string
  title: string
  articles: number
}) {
  return (
    <div className="rounded-md border border-border/50 p-1.5 cursor-pointer hover:border-border transition-all">
      <div className="text-xs mb-0.5">{icon}</div>
      <p className="text-[9px] font-semibold text-foreground line-clamp-1">{title}</p>
      <p className="text-[7px] text-muted-foreground/50 mt-0.5">{articles} articles</p>
    </div>
  )
}

function MockChatView({
  teamName,
  welcomeMessage,
}: {
  teamName?: string
  welcomeMessage?: string
}) {
  // Faithful mini of widget-messenger.tsx: an always-on presence strip, the
  // greeting as an agent bubble authored by the (optional) team name, and the
  // composer. When no welcome message is configured the real widget shows the
  // empty-state prompt rather than a greeting bubble — mirror that here.
  const author = teamName?.trim()
  const greeting = welcomeMessage?.trim()
  return (
    <div className="flex flex-col h-full">
      {/* Presence strip — the real widget always renders this availability row */}
      <div className="flex items-center gap-1.5 pb-1.5 mb-1.5 border-b border-border/40 shrink-0">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        <span className="text-[8px] text-muted-foreground">We&apos;re online</span>
      </div>

      <div className="flex-1 overflow-hidden">
        {greeting ? (
          <div className="space-y-1.5">
            {/* Agent greeting */}
            <div className="flex items-end gap-1">
              <div className="w-4 h-4 rounded-full bg-muted-foreground/20 shrink-0" />
              <div className="flex flex-col items-start max-w-[80%]">
                {author && (
                  <span className="text-[7px] text-muted-foreground/60 mb-0.5 px-0.5">
                    {author}
                  </span>
                )}
                <div className="rounded-lg rounded-bl-sm bg-muted px-2 py-1 text-[9px] text-foreground leading-snug line-clamp-3">
                  {greeting}
                </div>
              </div>
            </div>
            {/* Visitor reply — illustrative, shows the two-sided bubble styling */}
            <div className="flex items-end gap-1 flex-row-reverse">
              <div className="rounded-lg rounded-br-sm bg-primary px-2 py-1 text-[9px] text-primary-foreground leading-snug max-w-[80%]">
                Sounds great, thanks!
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-3">
            <ChatBubbleLeftRightIcon className="w-5 h-5 text-muted-foreground/30 mb-1" />
            <p className="text-[9px] font-medium text-muted-foreground/70">
              Send us a message and we&apos;ll get back to you.
            </p>
          </div>
        )}
      </div>

      {/* Composer — attach, message field, send (mirrors the real composer) */}
      <div className="mt-1.5 flex items-center gap-1 rounded-lg border border-border bg-muted/30 px-2 py-1.5 shrink-0">
        <PaperClipIcon className="w-3 h-3 text-muted-foreground/50 shrink-0" />
        <span className="flex-1 text-[9px] text-muted-foreground/60">Type your message…</span>
        <PaperAirplaneIcon className="w-3 h-3 text-primary/70 shrink-0" />
      </div>
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
