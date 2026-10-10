/**
 * English display labels for the status surfaces rendered outside the
 * portal's i18n (subscriber emails and the RSS feed). The portal page has
 * its own translated labels in `components/portal/status/status-colors.ts`.
 */
import type {
  StatusComponentStatus,
  StatusIncidentStatus,
  StatusMaintenanceStatus,
} from './status.types'

export const STATUS_COMPONENT_STATUS_LABELS: Record<StatusComponentStatus, string> = {
  operational: 'Operational',
  degraded_performance: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  under_maintenance: 'Under maintenance',
}

export const STATUS_LIFECYCLE_LABELS: Record<
  StatusIncidentStatus | StatusMaintenanceStatus,
  string
> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  verifying: 'Verifying',
  completed: 'Completed',
}
