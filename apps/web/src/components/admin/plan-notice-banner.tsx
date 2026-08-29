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
 * An expired product trial is a persistent red strip, not dismissible.
 */
export function PlanNoticeBanner({ notice }: PlanNoticeBannerProps) {
  const view = presentPlanNotice(notice)
  const dismissible = Boolean(notice?.dismissible)
  const [ready, setReady] = useState(!dismissible)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (!dismissible) {
      setDismissed(false)
      setReady(true)
      return
    }
    setDismissed(readDismissed(notice?.expiresAt))
    setReady(true)
  }, [dismissible, notice?.expiresAt])
  if (!view || !ready || (dismissible && dismissed)) return null

  const ended = view.ended
  const tone = ended
    ? 'bg-red-600 text-white border-red-700'
    : view.urgent
      ? 'bg-amber-500/10 border-amber-500/20'
      : 'bg-primary/5 border-primary/10'
  const muted = ended ? 'text-white/80' : 'text-muted-foreground'
  const actionClass = ended
    ? 'inline-flex items-center gap-1 font-medium text-white underline underline-offset-2 hover:text-white'
    : 'inline-flex items-center gap-1 text-primary font-medium hover:underline'

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
        <span className={`font-medium shrink-0 ${ended ? 'text-white' : 'text-foreground'}`}>
          {view.label}
        </span>
        {!ended && view.daysLeft !== null && (
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
                ? 'ends today'
                : `${view.daysLeft} day${view.daysLeft === 1 ? '' : 's'} left`}
            </span>
          </>
        )}
        {view.message && (
          <span className={`${muted} hidden sm:inline truncate`}>{view.message}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {view.actionUrl && (
          <a
            href={view.actionUrl}
            {...(view.actionUrl.startsWith('/')
              ? {}
              : { target: '_blank', rel: 'noopener noreferrer' })}
            className={actionClass}
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
