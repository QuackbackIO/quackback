import { Link } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { TimeAgo } from '@/components/ui/time-ago'
import { IMPACT_STYLE, IMPACT_LABEL, LIFECYCLE_LABEL } from './status-colors'
import type { StatusIncidentId, StatusComponentId } from '@quackback/ids'
import type { StatusIncidentImpact } from '@/lib/server/domains/status'
import type { LifecycleStatus } from './status-colors'

export interface StatusIncidentCardData {
  id: StatusIncidentId
  title: string
  status: LifecycleStatus
  impact: StatusIncidentImpact
  affectedComponents: Array<{ id: StatusComponentId; name: string }>
  updates: Array<{ id: string; body: string; createdAt: string }>
}

interface StatusIncidentCardProps {
  incident: StatusIncidentCardData
  className?: string
}

/** Banner-headed card for active incidents / in-progress maintenance — the
 *  incident doubles as the page's status banner: an impact-tinted header
 *  impact-tinted header strip with the title + lifecycle label, then the
 *  latest update excerpt and affected-component chips in the body. */
export function StatusIncidentCard({ incident, className }: StatusIncidentCardProps) {
  const intl = useIntl()
  const impactStyle = IMPACT_STYLE[incident.impact]
  // `updates` arrives oldest-first from the server; the excerpt wants the latest.
  const latestUpdate = incident.updates[incident.updates.length - 1]

  return (
    <Link
      to="/status/$incidentId"
      params={{ incidentId: incident.id }}
      className={cn(
        'block overflow-hidden rounded-lg border border-border/50 bg-card shadow-xs',
        'transition-colors hover:border-border',
        className
      )}
    >
      <div
        className={cn(
          'flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 px-4 py-2.5 text-white',
          impactStyle.solid
        )}
      >
        <h3 className="text-sm font-semibold">{incident.title}</h3>
        <span className="text-[11px] font-semibold tracking-wide uppercase text-white/85">
          {intl.formatMessage(LIFECYCLE_LABEL[incident.status])}
        </span>
      </div>
      <div className="px-4 py-3">
        {latestUpdate && (
          <p className="line-clamp-2 max-w-[75ch] text-[13px] text-muted-foreground">
            {latestUpdate.body}
          </p>
        )}
        <div
          className={cn(
            'flex flex-wrap items-center gap-2 text-xs text-muted-foreground',
            latestUpdate && 'mt-2.5'
          )}
        >
          {incident.affectedComponents.map((component) => (
            <span
              key={component.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5 font-medium"
            >
              {component.name}
            </span>
          ))}
          {incident.affectedComponents.length > 0 && <span>&middot;</span>}
          <span>{intl.formatMessage(IMPACT_LABEL[incident.impact])}</span>
          {latestUpdate && (
            <>
              <span>&middot;</span>
              <span>
                {intl.formatMessage({
                  id: 'portal.status.incidentCard.lastUpdate',
                  defaultMessage: 'Last update',
                })}{' '}
                <TimeAgo date={latestUpdate.createdAt} className="inline" />
              </span>
            </>
          )}
        </div>
      </div>
    </Link>
  )
}
