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
  activeIncidentCount: number
  /** Most recent update timestamp across active incidents/maintenance, ISO
   *  string. Null when there's nothing active — the "Updated" line is hidden. */
  lastUpdatedAt: string | null
  className?: string
}

/** The top banner: colored by the page's worst-of-visible-components status,
 *  with the fixed headline copy from the approved mockup. */
export function StatusHero({
  status,
  activeIncidentCount,
  lastUpdatedAt,
  className,
}: StatusHeroProps) {
  const intl = useIntl()
  const Icon = HERO_ICON[status]
  const style = COMPONENT_STATUS_STYLE[status]
  const headline = intl.formatMessage(HERO_HEADLINE[status])

  return (
    <div
      className={cn('flex items-center gap-3.5 rounded-2xl px-5 py-4 text-white', className)}
      style={{ backgroundColor: style.hex }}
    >
      <div className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full bg-white/20">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <h2 className="text-[17px] font-semibold tracking-tight">{headline}</h2>
        {(activeIncidentCount > 0 || lastUpdatedAt) && (
          <div className="mt-0.5 text-xs opacity-85">
            {activeIncidentCount > 0 && (
              <span>
                {intl.formatMessage(
                  {
                    id: 'portal.status.hero.activeIncidentCount',
                    defaultMessage:
                      '{count, plural, one {# active incident} other {# active incidents}}',
                  },
                  { count: activeIncidentCount }
                )}
              </span>
            )}
            {activeIncidentCount > 0 && lastUpdatedAt && <span> · </span>}
            {lastUpdatedAt && (
              <span>
                <FormattedMessage
                  id="portal.status.hero.updated"
                  defaultMessage="Updated {time}"
                  values={{ time: <TimeAgo date={lastUpdatedAt} className="inline" /> }}
                />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
