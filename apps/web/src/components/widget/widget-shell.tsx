import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeftIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  XMarkIcon,
  HomeIcon,
  ChatBubbleLeftRightIcon,
  LightBulbIcon,
  NewspaperIcon,
  QuestionMarkCircleIcon,
  ArrowTopRightOnSquareIcon,
} from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { Avatar } from '@/components/ui/avatar'
import { UserStatsBar } from '@/components/shared/user-stats'
import { getWidgetAuthHeaders, generateOneTimeToken } from '@/lib/client/widget-auth'
import { sendToHost } from '@/lib/client/widget-bridge'
import { useWidgetAuth } from './widget-auth-provider'

import { type WidgetTab, type EnabledTabs, visibleTabs } from './widget-nav'
export type { WidgetTab }

const TAB_CONFIG: {
  tab: WidgetTab
  icon: typeof LightBulbIcon
  labelId: string
  defaultLabel: string
}[] = [
  { tab: 'home', icon: HomeIcon, labelId: 'widget.shell.tab.home', defaultLabel: 'Home' },
  {
    tab: 'messages',
    icon: ChatBubbleLeftRightIcon,
    labelId: 'widget.shell.tab.messages',
    defaultLabel: 'Messages',
  },
  {
    tab: 'feedback',
    icon: LightBulbIcon,
    labelId: 'widget.shell.tab.feedback',
    defaultLabel: 'Feedback',
  },
  {
    tab: 'help',
    icon: QuestionMarkCircleIcon,
    labelId: 'widget.shell.tab.help',
    defaultLabel: 'Help',
  },
  {
    tab: 'changelog',
    icon: NewspaperIcon,
    labelId: 'widget.shell.tab.changelog',
    defaultLabel: 'Changelog',
  },
]

interface PortalAccessProps {
  /** Whether the portal is set to private visibility. */
  isPrivate: boolean
  /** Whether widget sign-in is enabled on this portal. */
  widgetSignIn: boolean
}

interface WidgetShellProps {
  orgSlug: string
  activeTab: WidgetTab
  onTabChange: (tab: WidgetTab) => void
  onBack?: () => void
  enabledTabs?: EnabledTabs
  /** Portal access config used to decide whether to show the "Go to portal" CTA. */
  portalAccess?: PortalAccessProps
  /**
   * The portal's own origin (e.g. "https://feedback.example.com"), resolved
   * server-side from BASE_URL. Used for the widget-handoff URL so the CTA
   * always points at the portal host, not at the widget iframe's origin (which
   * may differ in self-hosted setups where the widget is served from a
   * separate domain).
   */
  portalOrigin?: string
  /** Teammate avatars shown as a small cluster in the Home header. */
  team?: { name: string; avatarUrl: string | null }[]
  /** Home hero — when set, a full-panel backdrop (brand gradient or uploaded
   *  image) fills the widget behind the header and body, and the header floats
   *  transparently over it. */
  hero?: { style: 'gradient' | 'image'; imageUrl?: string | null } | null
  /** Workspace logo shown top-left on Home (null hides it). */
  logoUrl?: string | null
  /** Extra header content beside the back button (e.g. the messenger thread's
   *  assistant identity), keeping the widget to a single header row. */
  headerContent?: ReactNode
  /** Hide the bottom tab bar (immersive views like the conversation thread). */
  hideTabBar?: boolean
  /** Whether the host panel is expanded for the current view — the tab bar's
   *  return fade waits for the panel's shrink transition to settle. */
  panelExpanded?: boolean
  /** Manual panel-size control beside the close button (expandable views on
   *  desktop hosts only). Collapsing is sticky — it turns auto-expansion off. */
  expandControl?: { expanded: boolean; onToggle: () => void }
  children: ReactNode
}

export function WidgetShell({
  orgSlug,
  activeTab,
  onTabChange,
  onBack,
  enabledTabs = { feedback: true, changelog: false, help: false, messages: false },
  portalAccess,
  portalOrigin,
  team = [],
  hero = null,
  logoUrl = null,
  headerContent,
  hideTabBar = false,
  panelExpanded = false,
  expandControl,
  children,
}: WidgetShellProps) {
  const intl = useIntl()
  const tabsToShow = visibleTabs(enabledTabs)
  const showTabBar = tabsToShow.length > 1 && !hideTabBar
  const reduceMotion = useReducedMotion()
  // When the bar was hidden for an EXPANDED view, its return waits for the
  // host panel's shrink transition (~520ms) before fading in; returning from
  // a compact immersive view (the thread) fades back almost immediately.
  const hiddenWhileExpandedRef = useRef(false)
  useEffect(() => {
    if (hideTabBar) hiddenWhileExpandedRef.current = panelExpanded
  }, [hideTabBar, panelExpanded])
  // `hidden` is a dynamic variant so the exit can read the LATEST expansion
  // state via AnimatePresence's `custom` (the exiting element's own props are
  // frozen at its last visible render, when panelExpanded was still false).
  // On expand the panel grows, so the bar clears the frame at once — a
  // lingering fade would sit awkwardly over the growing canvas; the compact
  // immersive thread keeps a short fade out.
  const tabBarVariants = {
    visible: {
      opacity: 1,
      transition: reduceMotion
        ? { duration: 0 }
        : {
            delay: hiddenWhileExpandedRef.current ? 0.55 : 0.08,
            duration: 0.25,
            ease: 'easeOut' as const,
          },
    },
    hidden: (expanded: boolean) => ({
      opacity: 0,
      transition:
        reduceMotion || expanded ? { duration: 0 } : { duration: 0.16, ease: 'easeIn' as const },
    }),
  }
  const { user, isIdentified, hmacRequired, closeWidget } = useWidgetAuth()

  const onHome = activeTab === 'home' && !onBack
  // On Home with a hero, the header floats over the full-panel backdrop; over
  // an image hero the chrome switches to white for contrast against the scrim.
  const activeHero = onHome ? hero : null
  const headerFloats = activeHero !== null
  const overImage = activeHero?.style === 'image'

  // Global Escape key handler — close widget from anywhere
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeWidget()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeWidget])

  // "Go to portal" CTA — shown only when ALL three conditions hold:
  //   1. The visitor is HMAC-verified (hmacRequired=true and they are identified)
  //   2. The portal is private
  //   3. widgetSignIn is enabled
  const showPortalCta =
    hmacRequired &&
    isIdentified &&
    (portalAccess?.isPrivate ?? false) &&
    (portalAccess?.widgetSignIn ?? false)
  const [portalCtaError, setPortalCtaError] = useState(false)
  const handleGoToPortal = useCallback(async () => {
    setPortalCtaError(false)
    const ott = await generateOneTimeToken()
    if (!ott) {
      setPortalCtaError(true)
      return
    }
    // Prefer the server-resolved portal origin so the handoff URL targets the
    // portal host — not the widget iframe's origin, which may differ in
    // self-hosted setups where the widget is served from a separate domain.
    const origin = portalOrigin || window.location.origin
    const portalUrl = `${origin}/auth/widget-handoff?ott=${encodeURIComponent(ott)}`
    sendToHost({ type: 'quackback:navigate', url: portalUrl })
  }, [])

  return (
    <div className="relative flex flex-col h-full bg-background text-foreground overflow-x-hidden">
      {/* Full-panel hero backdrop — starts at the very top (behind the header)
          and fills the whole body; the solid bottom bar sits above it. */}
      {activeHero && (
        <div className="absolute inset-0 z-0" aria-hidden>
          {activeHero.style === 'image' && activeHero.imageUrl ? (
            <>
              <img src={activeHero.imageUrl} alt="" className="h-full w-full object-cover" />
              {/* Scrim: dark at the top for header/greeting contrast, fading
                  into the app background so the content stays readable. */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-background" />
            </>
          ) : (
            <div className="h-full w-full bg-gradient-to-b from-primary/30 via-primary/10 to-transparent" />
          )}
        </div>
      )}
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-4 py-3 shrink-0',
          headerFloats ? 'absolute inset-x-0 top-0 z-20' : 'relative z-10'
        )}
      >
        {/* Left: back button on detail views; workspace logo on Home. */}
        <div className="flex items-center gap-1">
          {onHome && logoUrl && (
            <img
              src={logoUrl}
              alt=""
              className={cn('h-6 max-w-[120px] object-contain', overImage && 'drop-shadow-sm')}
            />
          )}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
              aria-label={intl.formatMessage({
                id: 'widget.shell.aria.goBack',
                defaultMessage: 'Go back',
              })}
            >
              <ArrowLeftIcon className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
          {headerContent}
        </div>

        {/* Center: the title is absolutely centered on the header midpoint so it
            keeps its natural width (never squeezed by the right-zone controls),
            and only truncates via max-w if a long localized title would actually
            reach them. Detail views (with a back button) render their own heading
            in the body, so the title is suppressed there. */}
        {!onBack && activeTab !== 'home' && (
          <h2 className="pointer-events-none absolute left-1/2 max-w-[55%] -translate-x-1/2 truncate text-center text-base font-semibold text-foreground">
            {activeTab === 'feedback' ? (
              <FormattedMessage
                id="widget.shell.heading.feedback"
                defaultMessage="Share your ideas"
              />
            ) : activeTab === 'messages' ? (
              <FormattedMessage id="widget.shell.heading.messages" defaultMessage="Messages" />
            ) : activeTab === 'help' ? (
              <FormattedMessage id="widget.shell.heading.help" defaultMessage="Help & Support" />
            ) : (
              <FormattedMessage id="widget.shell.heading.changelog" defaultMessage="What's new" />
            )}
          </h2>
        )}

        {/* Right: portal CTA, user menu, and the always-present close. */}
        <div className="flex items-center gap-1">
          {/* Teammate cluster — Home only, a friendly "real people are here" cue. */}
          {activeTab === 'home' && !onBack && team.length > 0 && (
            <div className="flex items-center -space-x-2 me-1" aria-hidden>
              {team.map((member, i) => (
                <Avatar
                  key={`${member.name}-${i}`}
                  src={member.avatarUrl}
                  name={member.name}
                  className="size-7 text-[9px] ring-2 ring-background"
                />
              ))}
            </div>
          )}
          {showPortalCta && (
            <button
              type="button"
              onClick={handleGoToPortal}
              className="flex items-center gap-1 px-2 h-8 rounded-md text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              aria-label={intl.formatMessage({
                id: 'widget.shell.aria.goToPortal',
                defaultMessage: 'Go to portal',
              })}
            >
              <FormattedMessage id="widget.shell.goToPortal" defaultMessage="Portal" />
              <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
            </button>
          )}
          {user && <UserAvatarPopover user={user} />}
          {expandControl && (
            <button
              type="button"
              onClick={expandControl.onToggle}
              className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors"
              aria-label={
                expandControl.expanded
                  ? intl.formatMessage({
                      id: 'widget.shell.aria.collapse',
                      defaultMessage: 'Collapse widget',
                    })
                  : intl.formatMessage({
                      id: 'widget.shell.aria.expand',
                      defaultMessage: 'Expand widget',
                    })
              }
            >
              {expandControl.expanded ? (
                <ArrowsPointingInIcon className="w-4.5 h-4.5 text-muted-foreground" />
              ) : (
                <ArrowsPointingOutIcon className="w-4.5 h-4.5 text-muted-foreground" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={closeWidget}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
              overImage ? 'hover:bg-white/20' : 'hover:bg-muted'
            )}
            aria-label={intl.formatMessage({
              id: 'widget.shell.aria.close',
              defaultMessage: 'Close feedback widget',
            })}
          >
            <XMarkIcon
              className={cn(
                'w-5 h-5',
                overImage ? 'text-white drop-shadow-sm' : 'text-muted-foreground'
              )}
            />
          </button>
        </div>
      </div>

      {portalCtaError && (
        <p className="px-4 pb-1 text-[11px] text-destructive">
          <FormattedMessage
            id="widget.shell.goToPortal.error"
            defaultMessage="Couldn't generate sign-in link, please try again"
          />
        </p>
      )}

      <div className="relative z-10 flex-1 overflow-hidden min-h-0">{children}</div>

      {/* Bottom tab bar + footer — solid so the hero backdrop never bleeds through. */}
      <div
        className="relative z-10 border-t border-border/40 shrink-0 bg-background"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <AnimatePresence initial={false} custom={panelExpanded}>
          {showTabBar && (
            <motion.div
              key="tab-bar"
              custom={panelExpanded}
              variants={tabBarVariants}
              initial={{ opacity: 0 }}
              animate="visible"
              exit="hidden"
            >
              <div className="flex">
                {tabsToShow.map((tab) => {
                  const cfg = TAB_CONFIG.find((c) => c.tab === tab)
                  if (!cfg) return null
                  const Icon = cfg.icon
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => onTabChange(tab)}
                      className={cn(
                        'flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors',
                        activeTab === tab
                          ? 'text-primary'
                          : 'text-muted-foreground/60 hover:text-muted-foreground'
                      )}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-xs font-medium">
                        <FormattedMessage id={cfg.labelId} defaultMessage={cfg.defaultLabel} />
                      </span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="border-t border-border/20 py-2 flex items-center justify-center">
          <a
            href={`https://quackback.io?utm_campaign=${encodeURIComponent(orgSlug || 'unknown')}&utm_content=widget&utm_medium=referral&utm_source=powered-by`}
            target="_blank"
            className="group inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-all"
          >
            <img
              src="/logo.png"
              alt=""
              width={11}
              height={11}
              className="opacity-60 group-hover:opacity-100 transition-opacity"
            />
            <span>
              <FormattedMessage
                id="widget.shell.poweredBy"
                defaultMessage="Powered by {brand}"
                values={{ brand: <span className="font-medium">Quackback</span> }}
              />
            </span>
          </a>
        </div>
      </div>
    </div>
  )
}

function UserAvatarPopover({
  user,
}: {
  user: { name: string; email: string; avatarUrl: string | null }
}) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-8 w-8 items-center justify-center rounded-full hover:ring-2 hover:ring-primary/20 transition-all"
        aria-label={intl.formatMessage({
          id: 'widget.shell.aria.userMenu',
          defaultMessage: 'User menu',
        })}
      >
        <Avatar src={user.avatarUrl} name={user.name} className="size-8 text-[10px]" />
      </button>

      {open && (
        <div className="absolute end-0 top-full mt-1.5 z-50 w-56 rounded-lg border border-border bg-card shadow-lg">
          <div className="px-3 py-3">
            <div className="flex items-center gap-2.5">
              <Avatar src={user.avatarUrl} name={user.name} className="size-9 text-sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">{user.name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          </div>
          <div className="border-t border-border px-3 py-2.5">
            <UserStatsBar compact headers={getWidgetAuthHeaders()} />
          </div>
        </div>
      )}
    </div>
  )
}
