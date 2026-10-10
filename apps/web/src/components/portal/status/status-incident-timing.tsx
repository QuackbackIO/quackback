/**
 * When an incident or maintenance window happened, as the public detail page
 * and history state it. Times are UTC, matching the update timeline.
 *
 * A maintenance window is dated by its window, not by when someone created
 * it: before it starts the page says when it is scheduled for, and once it
 * has started it says when it actually started.
 */
import { useIntl } from 'react-intl'
import type { LifecycleStatus } from './status-colors'

export interface StatusIncidentTimingData {
  kind: 'incident' | 'maintenance'
  status: LifecycleStatus
  startedAt: string
  scheduledStartAt: string | null
  scheduledEndAt: string | null
}

const TIME: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
}

const DAY: Intl.DateTimeFormatOptions = {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
}

/** "Monday, October 12 · 14:00 – 16:00 UTC", the start alone when there is no
 *  end, and the end's day too when the window crosses midnight UTC. */
export function formatMaintenanceWindow(
  startIso: string | null,
  endIso: string | null,
  locale: string
): string {
  if (!startIso) return ''
  const start = new Date(startIso)
  const startLabel = `${start.toLocaleDateString(locale, DAY)} · ${start.toLocaleTimeString(locale, TIME)}`
  if (!endIso) return `${startLabel} UTC`
  const end = new Date(endIso)
  const endTime = end.toLocaleTimeString(locale, TIME)
  if (start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10)) {
    return `${startLabel} – ${endTime} UTC`
  }
  return `${startLabel} – ${end.toLocaleDateString(locale, DAY)} · ${endTime} UTC`
}

/** The date history files a row under: a maintenance window's start, an
 *  incident's start. */
export function statusIncidentDate(incident: StatusIncidentTimingData): string {
  return incident.kind === 'maintenance'
    ? (incident.scheduledStartAt ?? incident.startedAt)
    : incident.startedAt
}

export function StatusIncidentTiming({ incident }: { incident: StatusIncidentTimingData }) {
  const intl = useIntl()
  const windowLabel = formatMaintenanceWindow(
    incident.scheduledStartAt,
    incident.scheduledEndAt,
    intl.locale
  )

  if (incident.kind === 'maintenance' && incident.status === 'scheduled' && windowLabel) {
    return (
      <span className="text-xs text-muted-foreground">
        {incident.scheduledEndAt
          ? intl.formatMessage(
              {
                id: 'portal.status.incidentDetail.scheduledFor',
                defaultMessage: 'Scheduled for {window}',
              },
              { window: windowLabel }
            )
          : intl.formatMessage(
              { id: 'portal.status.incidentDetail.starts', defaultMessage: 'Starts {date}' },
              { date: windowLabel }
            )}
      </span>
    )
  }

  const started =
    new Date(incident.startedAt).toLocaleString(intl.locale, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      ...TIME,
    }) + ' UTC'

  return (
    <>
      <span className="text-xs text-muted-foreground">
        {intl.formatMessage(
          { id: 'portal.status.incidentDetail.started', defaultMessage: 'Started {date}' },
          { date: started }
        )}
      </span>
      {incident.kind === 'maintenance' && windowLabel && (
        <span className="text-xs text-muted-foreground">
          {intl.formatMessage(
            {
              id: 'portal.status.incidentDetail.scheduledWindow',
              defaultMessage: 'Scheduled window: {window}',
            },
            { window: windowLabel }
          )}
        </span>
      )}
    </>
  )
}
