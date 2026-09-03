import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'
import { presentPlanNotice } from '@/lib/shared/plan-notice'

interface PlanNoticeBannerProps {
  notice: PlanNotice | null
}

/**
 * Self-host operator strip, or a cloud trial countdown derived from the
 * billing projection. Not dismissible: an ended product trial stays until
 * they pick a plan.
 */
export function PlanNoticeBanner({ notice }: PlanNoticeBannerProps) {
  const view = presentPlanNotice(notice)
  if (!view) return null

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
      {view.actionUrl && (
        <a
          href={view.actionUrl}
          {...(view.actionUrl.startsWith('/')
            ? {}
            : { target: '_blank', rel: 'noopener noreferrer' })}
          className={`${actionClass} shrink-0`}
        >
          {view.actionLabel ?? 'Manage'}
          {!view.actionUrl.startsWith('/') && <ArrowTopRightOnSquareIcon className="h-3 w-3" />}
        </a>
      )}
    </div>
  )
}
