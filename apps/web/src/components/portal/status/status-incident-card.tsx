import { Link } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { cn } from '@/lib/shared/utils'
import { TimeAgo } from '@/components/ui/time-ago'
import { IMPACT_STYLE, IMPACT_LABEL, LIFECYCLE_STYLE, LIFECYCLE_LABEL } from './status-colors'
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

/** Left-border card for the active incidents / in-progress maintenance strip
 *  — border color + lifecycle label track impact severity, with the latest
 *  update's body as an excerpt and the affected-component chips below. */
export function StatusIncidentCard({ incident, className }: StatusIncidentCardProps) {
  const intl = useIntl()
  const impactStyle = IMPACT_STYLE[incident.impact]
  const lifecycleStyle = LIFECYCLE_STYLE[incident.status]
  // `updates` arrives oldest-first from the server; the excerpt wants the latest.
  const latestUpdate = incident.updates[incident.updates.length - 1]

  return (
    <Link
      to="/status/$incidentId"
      params={{ incidentId: incident.id }}
      className={cn(
        'block rounded-xl border border-l-[3px] border-border/50 bg-card p-3.5 shadow-xs',
        'transition-colors hover:border-border',
        className
      )}
      style={{ borderLeftColor: impactStyle.hex }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">{incident.title}</h3>
        <span
          className={cn('text-[11px] font-semibold tracking-wide uppercase', lifecycleStyle.text)}
        >
          {intl.formatMessage(LIFECYCLE_LABEL[incident.status])}
        </span>
      </div>
      {latestUpdate && (
        <p className="mt-1.5 line-clamp-2 max-w-[75ch] text-[13.5px] text-muted-foreground">
          {latestUpdate.body}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {incident.affectedComponents.map((component) => (
          <span
            key={component.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5 font-medium"
          >
            {component.name}
          </span>
        ))}
        <span>&middot;</span>
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
    </Link>
  )
}
