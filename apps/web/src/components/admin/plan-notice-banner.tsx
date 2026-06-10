import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import type { PlanNotice } from '@/lib/server/domains/settings/tier-limits.types'
import { presentPlanNotice } from '@/lib/shared/plan-notice'

interface PlanNoticeBannerProps {
  notice: PlanNotice | null
}

/**
 * Operator-set notice strip (e.g. "Free trial — 9 days left"). Driven
 * entirely by settings.tier_limits.notice; renders nothing when unset.
 * Not dismissible: it represents workspace state, and clearing the
 * notice (by whoever set it) is what removes it.
 */
export function PlanNoticeBanner({ notice }: PlanNoticeBannerProps) {
  const view = presentPlanNotice(notice)
  if (!view) return null

  const tone = view.urgent
    ? 'bg-amber-500/10 border-amber-500/20'
    : 'bg-primary/5 border-primary/10'

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm border-b ${tone}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium text-foreground shrink-0">{view.label}</span>
        {view.daysLeft !== null && (
          <>
            <span className="text-muted-foreground">—</span>
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
          <span className="text-muted-foreground hidden sm:inline truncate">{view.message}</span>
        )}
      </div>
      {view.actionUrl && (
        <a
          href={view.actionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center gap-1 text-primary font-medium hover:underline"
        >
          {view.actionLabel ?? 'Manage'}
          <ArrowTopRightOnSquareIcon className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}
