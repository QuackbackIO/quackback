/**
 * Colors + labels for the Status page ADMIN surfaces.
 *
 * Reuses the fixed severity ramp from the public portal's
 * `components/portal/status/status-colors.ts` (same hex values, same
 * semantics — emerald/amber/orange/red/blue, never theme `--primary`)
 * instead of re-declaring the palette. Admin surfaces use plain English
 * labels rather than the portal's `{id, defaultMessage}` i18n descriptors,
 * since the rest of /admin is not localized — so labels are derived from
 * the portal's `defaultMessage` strings (kept in sync, not hand-copied).
 */
import type {
  StatusComponentStatus,
  StatusIncidentImpact,
  StatusIncidentKind,
} from '@/lib/server/domains/status'
import {
  COMPONENT_STATUS_STYLE,
  COMPONENT_STATUS_LABEL,
  IMPACT_STYLE,
  IMPACT_LABEL,
  LIFECYCLE_STYLE,
  LIFECYCLE_LABEL,
  type LifecycleStatus,
} from '@/components/portal/status/status-colors'

export type { StatusComponentStatus, StatusIncidentImpact, StatusIncidentKind }
export type StatusIncidentLifecycle = LifecycleStatus

export const COMPONENT_STATUS_VALUES: readonly StatusComponentStatus[] = [
  'operational',
  'degraded_performance',
  'partial_outage',
  'major_outage',
  'under_maintenance',
]

export const COMPONENT_STATUS_COLORS: Record<StatusComponentStatus, string> = {
  operational: COMPONENT_STATUS_STYLE.operational.hex,
  degraded_performance: COMPONENT_STATUS_STYLE.degraded_performance.hex,
  partial_outage: COMPONENT_STATUS_STYLE.partial_outage.hex,
  major_outage: COMPONENT_STATUS_STYLE.major_outage.hex,
  under_maintenance: COMPONENT_STATUS_STYLE.under_maintenance.hex,
}

export const COMPONENT_STATUS_LABELS: Record<StatusComponentStatus, string> = {
  operational: COMPONENT_STATUS_LABEL.operational.defaultMessage,
  degraded_performance: COMPONENT_STATUS_LABEL.degraded_performance.defaultMessage,
  partial_outage: COMPONENT_STATUS_LABEL.partial_outage.defaultMessage,
  major_outage: COMPONENT_STATUS_LABEL.major_outage.defaultMessage,
  under_maintenance: COMPONENT_STATUS_LABEL.under_maintenance.defaultMessage,
}

export const COMPONENT_STATUS_OPTIONS = COMPONENT_STATUS_VALUES.map((value) => ({
  value,
  label: COMPONENT_STATUS_LABELS[value],
  color: COMPONENT_STATUS_COLORS[value],
}))

export const IMPACT_COLORS: Record<StatusIncidentImpact, string> = {
  none: IMPACT_STYLE.none.hex,
  minor: IMPACT_STYLE.minor.hex,
  major: IMPACT_STYLE.major.hex,
  critical: IMPACT_STYLE.critical.hex,
  maintenance: IMPACT_STYLE.maintenance.hex,
}

export const IMPACT_LABELS: Record<StatusIncidentImpact, string> = {
  none: IMPACT_LABEL.none.defaultMessage,
  minor: IMPACT_LABEL.minor.defaultMessage,
  major: IMPACT_LABEL.major.defaultMessage,
  critical: IMPACT_LABEL.critical.defaultMessage,
  maintenance: IMPACT_LABEL.maintenance.defaultMessage,
}

/** Lifecycle labels shared across incident + maintenance statuses. */
export const LIFECYCLE_LABELS: Record<StatusIncidentLifecycle, string> = {
  investigating: LIFECYCLE_LABEL.investigating.defaultMessage,
  identified: LIFECYCLE_LABEL.identified.defaultMessage,
  monitoring: LIFECYCLE_LABEL.monitoring.defaultMessage,
  resolved: LIFECYCLE_LABEL.resolved.defaultMessage,
  scheduled: LIFECYCLE_LABEL.scheduled.defaultMessage,
  in_progress: LIFECYCLE_LABEL.in_progress.defaultMessage,
  verifying: LIFECYCLE_LABEL.verifying.defaultMessage,
  completed: LIFECYCLE_LABEL.completed.defaultMessage,
}

/** Lifecycle badge dot color — same ramp the portal uses for the update timeline. */
export const LIFECYCLE_COLORS: Record<StatusIncidentLifecycle, string> = {
  investigating: LIFECYCLE_STYLE.investigating.hex,
  identified: LIFECYCLE_STYLE.identified.hex,
  monitoring: LIFECYCLE_STYLE.monitoring.hex,
  resolved: LIFECYCLE_STYLE.resolved.hex,
  scheduled: LIFECYCLE_STYLE.scheduled.hex,
  in_progress: LIFECYCLE_STYLE.in_progress.hex,
  verifying: LIFECYCLE_STYLE.verifying.hex,
  completed: LIFECYCLE_STYLE.completed.hex,
}

export const INCIDENT_LIFECYCLE_VALUES: readonly StatusIncidentLifecycle[] = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
]

export const MAINTENANCE_LIFECYCLE_VALUES: readonly StatusIncidentLifecycle[] = [
  'scheduled',
  'in_progress',
  'verifying',
  'completed',
]

export function lifecycleValuesForKind(
  kind: StatusIncidentKind
): readonly StatusIncidentLifecycle[] {
  return kind === 'maintenance' ? MAINTENANCE_LIFECYCLE_VALUES : INCIDENT_LIFECYCLE_VALUES
}

export function isTerminalLifecycle(status: StatusIncidentLifecycle): boolean {
  return status === 'resolved' || status === 'completed'
}

export function lifecycleOptionsForKind(kind: StatusIncidentKind) {
  return lifecycleValuesForKind(kind).map((value) => ({
    value,
    label: LIFECYCLE_LABELS[value],
    color: LIFECYCLE_COLORS[value],
  }))
}

/** Sensible default component status to apply when a component is newly
 *  marked "affected" by an incident/maintenance composer. */
export function defaultAffectedStatus(kind: StatusIncidentKind): StatusComponentStatus {
  return kind === 'maintenance' ? 'under_maintenance' : 'degraded_performance'
}
