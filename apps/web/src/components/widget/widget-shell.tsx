import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeftIcon,
  XMarkIcon,
  LightBulbIcon,
  NewspaperIcon,
  BookOpenIcon,
} from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { Avatar } from '@/components/ui/avatar'
import { UserStatsBar } from '@/components/shared/user-stats'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'

export type WidgetTab = 'feedback' | 'changelog' | 'help'

const TAB_CONFIG: {
  tab: WidgetTab
  icon: typeof LightBulbIcon
  labelId: string
  defaultLabel: string
}[] = [
  {
    tab: 'feedback',
    icon: LightBulbIcon,
    labelId: 'widget.shell.tab.feedback',
    defaultLabel: 'Feedback',
  },
  {
    tab: 'changelog',
    icon: NewspaperIcon,
    labelId: 'widget.shell.tab.changelog',
    defaultLabel: 'Changelog',
  },
  { tab: 'help', icon: BookOpenIcon, labelId: 'widget.shell.tab.help', defaultLabel: 'Help' },
]

interface WidgetShellProps {
  orgSlug: string
  activeTab: WidgetTab
  onTabChange: (tab: WidgetTab) => void
  onBack?: () => void
  enabledTabs?: { feedback?: boolean; changelog?: boolean; help?: boolean }
  children: ReactNode
}

export function WidgetShell({
  orgSlug,
  activeTab,
  onTabChange,
  onBack,
  enabledTabs = { feedback: true, changelog: false, help: false },
  children,
}: WidgetShellProps) {
  const intl = useIntl()
  const enabledCount = [enabledTabs.feedback, enabledTabs.changelog, enabledTabs.help].filter(
    Boolean
  ).length
  const showTabBar = enabledCount > 1
  const { user, closeWidget } = useWidgetAuth()
  const showCloseButton =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('showClose') === '1'

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

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-x-hidden">
      <div className="flex items-center justify-between px-3 pt-2 pb-0.5 shrink-0">
        <div className="flex items-center gap-1">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
              aria-label={intl.formatMessage({
                id: 'widget.shell.aria.goBack',
                defaultMessage: 'Go back',
              })}
            >
              <ArrowLeftIcon className="w-4 h-4 text-muted-foreground" />
            </button>
          ) : (
            <h2 className="text-sm font-semibold text-foreground ps-0.5">
              {activeTab === 'feedback' ? (
                <FormattedMessage
                  id="widget.shell.heading.feedback"
                  defaultMessage="Share your ideas"
                />
              ) : activeTab === 'help' ? (
                <FormattedMessage id="widget.shell.heading.help" defaultMessage="Help Center" />
              ) : (
                <FormattedMessage id="widget.shell.heading.changelog" defaultMessage="What's new" />
              )}
            </h2>
          )}
        </div>
        <div className="flex items-center gap-1">
          {user && <UserAvatarPopover user={user} />}
          {showCloseButton && (
            <button
              type="button"
              onClick={closeWidget}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
              aria-label={intl.formatMessage({
                id: 'widget.shell.aria.close',
                defaultMessage: 'Close feedback widget',
              })}
            >
              <XMarkIcon className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-h-0">{children}</div>

      {/* Bottom tab bar + footer */}
      <div className="border-t border-border/40 shrink-0">
        {showTabBar && (
          <div className="flex">
            {TAB_CONFIG.filter(({ tab }) => enabledTabs[tab]).map(
              ({ tab, icon: Icon, labelId, defaultLabel }) => (
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
                    <FormattedMessage id={labelId} defaultMessage={defaultLabel} />
                  </span>
                </button>
              )
            )}
          </div>
        )}

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
        className="w-7 h-7 flex items-center justify-center rounded-full hover:ring-2 hover:ring-primary/20 transition-all"
        aria-label={intl.formatMessage({
          id: 'widget.shell.aria.userMenu',
          defaultMessage: 'User menu',
        })}
      >
        <Avatar src={user.avatarUrl} name={user.name} className="size-7 text-[10px]" />
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
