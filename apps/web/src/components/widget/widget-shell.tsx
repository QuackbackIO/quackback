'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeftIcon, LightBulbIcon, NewspaperIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Avatar } from '@/components/ui/avatar'
import { UserStatsBar } from '@/components/shared/user-stats'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { useWidgetAuth } from './widget-auth-provider'

export type WidgetTab = 'feedback' | 'changelog'

interface WidgetShellProps {
  orgSlug: string
  activeTab: WidgetTab
  onTabChange: (tab: WidgetTab) => void
  onBack?: () => void
  enabledTabs?: { feedback?: boolean; changelog?: boolean }
  children: ReactNode
}

export function WidgetShell({
  orgSlug,
  activeTab,
  onTabChange,
  onBack,
  enabledTabs = { feedback: true, changelog: false },
  children,
}: WidgetShellProps) {
  const showTabBar = enabledTabs.feedback && enabledTabs.changelog
  const { user, closeWidget } = useWidgetAuth()

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
    <div className="flex flex-col h-full bg-background text-foreground">
      <div className="flex items-center justify-between px-3 pt-2 pb-0.5 shrink-0">
        <div className="flex items-center gap-1">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
              aria-label="Go back"
            >
              <ArrowLeftIcon className="w-4 h-4 text-muted-foreground" />
            </button>
          ) : (
            <h2 className="text-sm font-semibold text-foreground pl-0.5">
              {activeTab === 'feedback' ? 'Share your ideas' : "What's new"}
            </h2>
          )}
        </div>
        <div className="flex items-center gap-1">{user && <UserAvatarPopover user={user} />}</div>
      </div>

      <div className="flex-1 overflow-hidden min-h-0">{children}</div>

      {/* Bottom tab bar + footer */}
      <div className="border-t border-border/40 shrink-0">
        {showTabBar && (
          <div className="flex">
            <button
              type="button"
              onClick={() => onTabChange('feedback')}
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors',
                activeTab === 'feedback'
                  ? 'text-primary'
                  : 'text-muted-foreground/60 hover:text-muted-foreground'
              )}
            >
              <LightBulbIcon className="w-5 h-5" />
              <span className="text-xs font-medium">Feedback</span>
            </button>
            <button
              type="button"
              onClick={() => onTabChange('changelog')}
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors',
                activeTab === 'changelog'
                  ? 'text-primary'
                  : 'text-muted-foreground/60 hover:text-muted-foreground'
              )}
            >
              <NewspaperIcon className="w-5 h-5" />
              <span className="text-xs font-medium">Changelog</span>
            </button>
          </div>
        )}

        <div className={cn('text-center', showTabBar ? 'pb-1' : 'py-1.5')}>
          <a
            href={`https://quackback.io?utm_campaign=${encodeURIComponent(orgSlug || 'unknown')}&utm_content=widget&utm_medium=referral&utm_source=powered-by`}
            target="_blank"
            className="group inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-all px-2.5 py-1 rounded-full bg-muted/50 hover:bg-muted border border-transparent hover:border-border/50"
          >
            <img
              src="/logo.png"
              alt=""
              width={11}
              height={11}
              className="opacity-60 group-hover:opacity-100 transition-opacity"
            />
            <span>
              Powered by <span className="font-medium">Quackback</span>
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
        aria-label="User menu"
      >
        <Avatar src={user.avatarUrl} name={user.name} className="size-6 text-[10px]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-lg border border-border bg-card shadow-lg">
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
