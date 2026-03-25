'use client'

import { useEffect, type ReactNode } from 'react'
import { ArrowLeftIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { LightBulbIcon, NewspaperIcon } from '@heroicons/react/24/outline'
import {
  LightBulbIcon as LightBulbIconSolid,
  NewspaperIcon as NewspaperIconSolid,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
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
        <div className="flex items-center gap-1">
          {user && (
            <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <button
            type="button"
            onClick={closeWidget}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
            aria-label="Close feedback widget"
          >
            <XMarkIcon className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-h-0">{children}</div>

      {/* Bottom tab bar + footer */}
      <div className="border-t border-border shrink-0">
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
              {activeTab === 'feedback' ? (
                <LightBulbIconSolid className="w-5 h-5" />
              ) : (
                <LightBulbIcon className="w-5 h-5" />
              )}
              <span className="text-[10px] font-medium">Feedback</span>
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
              {activeTab === 'changelog' ? (
                <NewspaperIconSolid className="w-5 h-5" />
              ) : (
                <NewspaperIcon className="w-5 h-5" />
              )}
              <span className="text-[10px] font-medium">Changelog</span>
            </button>
          </div>
        )}

        <div className={cn('text-center', showTabBar ? 'pb-1' : 'py-1.5')}>
          <a
            href={`https://quackback.io?utm_campaign=${encodeURIComponent(orgSlug || 'unknown')}&utm_content=widget&utm_medium=referral&utm_source=powered-by`}
            target="_blank"
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <img
              src="/logo.png"
              alt=""
              width={12}
              height={12}
              className="opacity-60"
              aria-hidden="true"
            />
            Powered by Quackback
          </a>
        </div>
      </div>
    </div>
  )
}
