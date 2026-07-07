/**
 * Fixed semantic colors + labels for the public Status page.
 *
 * These are intentionally NOT theme `--primary` tokens: tenant brands
 * recolor `--primary`, but incident severity needs to read the same way on
 * every workspace (emerald=ok, amber=degraded, orange=partial, red=major,
 * blue=maintenance) — mirroring the approved mockup's fixed status ramp.
 */
import type {
  StatusComponentStatus,
  StatusIncidentImpact,
  StatusIncidentStatus,
  StatusMaintenanceStatus,
} from '@/lib/server/domains/status'

export type LifecycleStatus = StatusIncidentStatus | StatusMaintenanceStatus

export interface StatusColorStyle {
  /** Tailwind class for a solid dot/bar (`bg-*-500`). */
  dot: string
  /** Tailwind class for text (`text-*-600 dark:text-*-400`). */
  text: string
  /** Tailwind class for a soft background chip (`bg-*-500/10`). */
  soft: string
  /** Raw hex, for inline styles (hero banner background, border-left color, native title tooltips). */
  hex: string
}

interface I18nLabel {
  id: string
  defaultMessage: string
}

const emerald: StatusColorStyle = {
  dot: 'bg-emerald-500',
  text: 'text-emerald-600 dark:text-emerald-400',
  soft: 'bg-emerald-500/10',
  hex: '#10b981',
}
const amber: StatusColorStyle = {
  dot: 'bg-amber-500',
  text: 'text-amber-600 dark:text-amber-400',
  soft: 'bg-amber-500/10',
  hex: '#f59e0b',
}
const orange: StatusColorStyle = {
  dot: 'bg-orange-500',
  text: 'text-orange-600 dark:text-orange-400',
  soft: 'bg-orange-500/10',
  hex: '#f97316',
}
const red: StatusColorStyle = {
  dot: 'bg-red-500',
  text: 'text-red-600 dark:text-red-400',
  soft: 'bg-red-500/10',
  hex: '#ef4444',
}
const blue: StatusColorStyle = {
  dot: 'bg-blue-500',
  text: 'text-blue-600 dark:text-blue-400',
  soft: 'bg-blue-500/10',
  hex: '#3b82f6',
}
const gray: StatusColorStyle = {
  dot: 'bg-muted-foreground/50',
  text: 'text-muted-foreground',
  soft: 'bg-muted/60',
  hex: '#94a3b8',
}

export const COMPONENT_STATUS_STYLE: Record<StatusComponentStatus, StatusColorStyle> = {
  operational: emerald,
  degraded_performance: amber,
  partial_outage: orange,
  major_outage: red,
  under_maintenance: blue,
}

export const COMPONENT_STATUS_LABEL: Record<StatusComponentStatus, I18nLabel> = {
  operational: { id: 'portal.status.componentStatus.operational', defaultMessage: 'Operational' },
  degraded_performance: {
    id: 'portal.status.componentStatus.degradedPerformance',
    defaultMessage: 'Degraded performance',
  },
  partial_outage: {
    id: 'portal.status.componentStatus.partialOutage',
    defaultMessage: 'Partial outage',
  },
  major_outage: { id: 'portal.status.componentStatus.majorOutage', defaultMessage: 'Major outage' },
  under_maintenance: {
    id: 'portal.status.componentStatus.underMaintenance',
    defaultMessage: 'Under maintenance',
  },
}

/** Headline copy for the hero banner, keyed by the page's top-level status. */
export const HERO_HEADLINE: Record<StatusComponentStatus, I18nLabel> = {
  operational: {
    id: 'portal.status.hero.operational',
    defaultMessage: 'All systems operational',
  },
  degraded_performance: {
    id: 'portal.status.hero.degradedPerformance',
    defaultMessage: 'Partially degraded service',
  },
  partial_outage: {
    id: 'portal.status.hero.partialOutage',
    defaultMessage: 'Partial system outage',
  },
  major_outage: {
    id: 'portal.status.hero.majorOutage',
    defaultMessage: 'Major system outage',
  },
  under_maintenance: {
    id: 'portal.status.hero.underMaintenance',
    defaultMessage: 'Scheduled maintenance in progress',
  },
}

export const IMPACT_STYLE: Record<StatusIncidentImpact, StatusColorStyle> = {
  none: gray,
  minor: amber,
  major: orange,
  critical: red,
  maintenance: blue,
}

export const IMPACT_LABEL: Record<StatusIncidentImpact, I18nLabel> = {
  none: { id: 'portal.status.impact.none', defaultMessage: 'No impact' },
  minor: { id: 'portal.status.impact.minor', defaultMessage: 'Minor impact' },
  major: { id: 'portal.status.impact.major', defaultMessage: 'Major impact' },
  critical: { id: 'portal.status.impact.critical', defaultMessage: 'Critical impact' },
  maintenance: { id: 'portal.status.impact.maintenance', defaultMessage: 'Maintenance' },
}

export const LIFECYCLE_STYLE: Record<LifecycleStatus, StatusColorStyle> = {
  investigating: red,
  identified: orange,
  monitoring: amber,
  resolved: emerald,
  scheduled: blue,
  in_progress: blue,
  verifying: blue,
  completed: emerald,
}

export const LIFECYCLE_LABEL: Record<LifecycleStatus, I18nLabel> = {
  investigating: { id: 'portal.status.lifecycle.investigating', defaultMessage: 'Investigating' },
  identified: { id: 'portal.status.lifecycle.identified', defaultMessage: 'Identified' },
  monitoring: { id: 'portal.status.lifecycle.monitoring', defaultMessage: 'Monitoring' },
  resolved: { id: 'portal.status.lifecycle.resolved', defaultMessage: 'Resolved' },
  scheduled: { id: 'portal.status.lifecycle.scheduled', defaultMessage: 'Scheduled' },
  in_progress: { id: 'portal.status.lifecycle.inProgress', defaultMessage: 'In progress' },
  verifying: { id: 'portal.status.lifecycle.verifying', defaultMessage: 'Verifying' },
  completed: { id: 'portal.status.lifecycle.completed', defaultMessage: 'Completed' },
}

/** Severity order for "worst status wins" roll-ups (component group headers).
 *  Mirrors `deriveTopLevelStatus` in `domains/status/status.calc.ts`: maintenance
 *  ranks below the three outage severities. Duplicated locally (small, pure)
 *  rather than imported, so this client module has zero runtime dependency on
 *  server code — only the `import type` above, which the bundler erases. */
const SEVERITY_ORDER: readonly StatusComponentStatus[] = [
  'operational',
  'under_maintenance',
  'degraded_performance',
  'partial_outage',
  'major_outage',
]

export function worstComponentStatus(statuses: StatusComponentStatus[]): StatusComponentStatus {
  let worstRank = 0
  for (const status of statuses) {
    const rank = SEVERITY_ORDER.indexOf(status)
    if (rank > worstRank) worstRank = rank
  }
  return SEVERITY_ORDER[worstRank]
}
