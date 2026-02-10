'use client'

import { useEffect, type ReactNode } from 'react'
import { ArrowLeftIcon, XMarkIcon } from '@heroicons/react/24/solid'
import { useWidgetAuth } from './widget-auth-provider'

interface WidgetShellProps {
  orgName: string
  orgSlug: string
  logoUrl: string | null
  title?: string
  onBack?: () => void
  children: ReactNode
}

export function WidgetShell({
  orgName,
  orgSlug,
  logoUrl,
  title,
  onBack,
  children,
}: WidgetShellProps) {
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
      <div className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-muted transition-colors shrink-0"
              aria-label="Go back"
            >
              <ArrowLeftIcon className="w-4 h-4 text-muted-foreground" />
            </button>
          ) : logoUrl ? (
            <img src={logoUrl} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" />
          ) : (
            <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-primary">
                {orgName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <span className="text-sm font-semibold truncate">{title ?? orgName}</span>
        </div>
        <div className="flex items-center gap-1.5">
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

      <div className="px-4 py-1.5 border-t border-border text-center shrink-0">
        <a
          href={`https://quackback.io?utm_campaign=${encodeURIComponent(orgSlug || 'unknown')}&utm_content=widget&utm_medium=referral&utm_source=powered-by`}
          target="_blank"
          rel="noopener noreferrer"
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
  )
}
