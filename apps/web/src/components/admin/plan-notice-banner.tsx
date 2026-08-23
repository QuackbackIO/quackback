import { useEffect, useState } from 'react'
import { ArrowTopRightOnSquareIcon, XMarkIcon } from '@heroicons/react/24/solid'
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'
import { presentPlanNotice } from '@/lib/shared/plan-notice'
import { trialEndedStorageKey } from '@/lib/shared/billing/trial-state'

interface PlanNoticeBannerProps {
  notice: PlanNotice | null
}

function readDismissed(expiresAt: string | undefined): boolean {
  if (typeof window === 'undefined' || !expiresAt) return false
  try {
    return window.localStorage.getItem(trialEndedStorageKey(expiresAt)) === '1'
  } catch {
    return false
  }
}

/**
 * Operator-set or trial notice strip. Driven by settings.tier_limits.notice
 * or a derived trial countdown. Operator notices are not dismissible.
 * The ended-trial banner is, via per-admin localStorage.
 */
export function PlanNoticeBanner({ notice }: PlanNoticeBannerProps) {
  const view = presentPlanNotice(notice)
  const dismissible = Boolean(notice?.dismissible)
  const [ready, setReady] = useState(!dismissible)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (!dismissible) return
    setDismissed(readDismissed(notice?.expiresAt))
    setReady(true)
  }, [dismissible, notice?.expiresAt])
  if (!view || !ready || dismissed) return null

  const tone = view.urgent
    ? 'bg-amber-500/10 border-amber-500/20'
    : 'bg-primary/5 border-primary/10'

  function dismiss() {
    if (notice?.expiresAt) {
      try {
        window.localStorage.setItem(trialEndedStorageKey(notice.expiresAt), '1')
      } catch {
        /* private mode */
      }
    }
    setDismissed(true)
  }

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm border-b ${tone}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium text-foreground shrink-0">{view.label}</span>
        {view.daysLeft !== null && (
          <>
            <span className="text-muted-foreground">·</span>
            <span
              className={
                view.urgent
                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                  : 'text-muted-foreground'
              }
            >
              {view.daysLeft === 0
                ? view.dismissible
                  ? 'ended'
                  : 'ends today'
                : `${view.daysLeft} day${view.daysLeft === 1 ? '' : 's'} left`}
            </span>
          </>
        )}
        {view.message && (
          <span className="text-muted-foreground hidden sm:inline truncate">{view.message}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {view.actionUrl && (
          <a
            href={view.actionUrl}
            {...(view.actionUrl.startsWith('/')
              ? {}
              : { target: '_blank', rel: 'noopener noreferrer' })}
            className="inline-flex items-center gap-1 text-primary font-medium hover:underline"
          >
            {view.actionLabel ?? 'Manage'}
            {!view.actionUrl.startsWith('/') && <ArrowTopRightOnSquareIcon className="h-3 w-3" />}
          </a>
        )}
        {view.dismissible ? (
          <button
            type="button"
            onClick={dismiss}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <XMarkIcon className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  )
}
