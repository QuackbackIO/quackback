import { useIntl, FormattedMessage } from 'react-intl'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { TimeAgo } from '@/components/ui/time-ago'
import { COMPONENT_STATUS_STYLE, HERO_HEADLINE } from './status-colors'
import type { StatusComponentStatus } from '@/lib/server/domains/status'

const HERO_ICON: Record<StatusComponentStatus, typeof CheckCircleIcon> = {
  operational: CheckCircleIcon,
  degraded_performance: ExclamationTriangleIcon,
  partial_outage: ExclamationTriangleIcon,
  major_outage: XCircleIcon,
  under_maintenance: WrenchScrewdriverIcon,
}

interface StatusHeroProps {
  status: StatusComponentStatus
  /** Most recent update timestamp across active incidents/maintenance, ISO
   *  string. Null when there's nothing active — the "Updated" line is hidden. */
  lastUpdatedAt: string | null
  className?: string
}

/** The top banner: a solid bar colored by the page's
 *  worst-of-visible-components status. Only shown when no incident is active
 *  — an active incident renders its own banner card instead. */
export function StatusHero({ status, lastUpdatedAt, className }: StatusHeroProps) {
  const intl = useIntl()
  const Icon = HERO_ICON[status]
  const style = COMPONENT_STATUS_STYLE[status]
  const headline = intl.formatMessage(HERO_HEADLINE[status])

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg px-4 py-3.5 text-white',
        style.solid,
        className
      )}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{headline}</h2>
        {lastUpdatedAt && (
          <span className="text-xs text-white/80">
            <FormattedMessage
              id="portal.status.hero.updated"
              defaultMessage="Updated {time}"
              values={{ time: <TimeAgo date={lastUpdatedAt} className="inline" /> }}
            />
          </span>
        )}
      </div>
    </div>
  )
}
