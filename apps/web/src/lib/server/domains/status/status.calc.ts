/**
 * Pure derivation functions for the Status page (Status Product Spec §5).
 * No DB access — unit-testable in isolation.
 */
import type { StatusComponentStatus, StatusIncidentImpact } from '@/lib/server/db'
import type { UptimeDay } from './status.types'

/**
 * Severity order for the worst-of derivations. `operational` is the baseline
 * (contributes nothing); among the rest, maintenance ranks below the three
 * outage severities (Status Product Spec §2).
 */
const SEVERITY_ORDER: readonly StatusComponentStatus[] = [
  'operational',
  'under_maintenance',
  'degraded_performance',
  'partial_outage',
  'major_outage',
]

/**
 * Top-level page status: all components operational -> 'operational'; else
 * the worst status present, ranked maintenance < degraded < partial < major.
 * Empty input (no visible components) is treated as operational.
 */
export function deriveTopLevelStatus(
  componentStatuses: StatusComponentStatus[]
): StatusComponentStatus {
  let worstRank = 0
  for (const status of componentStatuses) {
    const rank = SEVERITY_ORDER.indexOf(status)
    if (rank > worstRank) worstRank = rank
  }
  return SEVERITY_ORDER[worstRank]
}

const IMPACT_RANK: Record<StatusComponentStatus, number> = {
  operational: 0,
  // Maintenance is not an incident-impact signal; it never raises impact.
  under_maintenance: 0,
  degraded_performance: 1,
  partial_outage: 2,
  major_outage: 3,
}

const IMPACT_BY_RANK: readonly StatusIncidentImpact[] = ['none', 'minor', 'major', 'critical']

/**
 * Auto-derived incident impact from the worst affected-component status.
 * Only meaningful for kind='incident' — maintenance rows always use the
 * literal 'maintenance' impact value instead of calling this.
 */
export function deriveImpact(componentStatuses: StatusComponentStatus[]): StatusIncidentImpact {
  let worstRank = 0
  for (const status of componentStatuses) {
    const rank = IMPACT_RANK[status]
    if (rank > worstRank) worstRank = rank
  }
  return IMPACT_BY_RANK[worstRank]
}

/** Statuses that do NOT count against uptime (Status Product Spec §2, decision 2). */
const UPTIME_STATUSES = new Set<StatusComponentStatus>(['operational', 'under_maintenance'])

export interface UptimeStatusEvent {
  status: StatusComponentStatus
  createdAt: Date
}

/**
 * Derive a daily uptime series from an append-only status-event log.
 *
 * Events are a step function: a status is active from its `createdAt` until
 * the next event (or `now` for the most recent). `initialStatus` is the
 * status in effect at the start of the window when no event predates it.
 * For each UTC day, `worstStatus` is the worst status active at any point
 * during the day; `uptimePct` is the time-weighted share of that day spent
 * in an uptime status (`operational` / `under_maintenance`). The final day
 * (today) is clipped at `now`, not the full 24h.
 *
 * Returns `windowDays` entries in ascending date order, ending today (UTC).
 */
export function deriveUptimeDays(
  events: UptimeStatusEvent[],
  initialStatus: StatusComponentStatus,
  windowDays: number,
  now: Date = new Date()
): UptimeDay[] {
  const DAY_MS = 24 * 60 * 60 * 1000
  const nowMs = now.getTime()
  const todayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const windowStartMs = todayStartMs - (windowDays - 1) * DAY_MS

  const sorted = [...events]
    .filter((e) => e.createdAt.getTime() <= nowMs)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  // Status in effect at windowStartMs: the last event at or before it, else the baseline.
  let statusAtWindowStart = initialStatus
  for (const e of sorted) {
    if (e.createdAt.getTime() <= windowStartMs) {
      statusAtWindowStart = e.status
    } else {
      break
    }
  }

  // Build step segments covering [windowStartMs, nowMs).
  const segments: { start: number; end: number; status: StatusComponentStatus }[] = []
  let cursor = windowStartMs
  let currentStatus = statusAtWindowStart
  for (const e of sorted) {
    const t = e.createdAt.getTime()
    if (t <= windowStartMs) continue
    if (t > cursor) {
      segments.push({ start: cursor, end: t, status: currentStatus })
      cursor = t
    }
    currentStatus = e.status
  }
  if (cursor < nowMs) {
    segments.push({ start: cursor, end: nowMs, status: currentStatus })
  }

  const days: UptimeDay[] = []
  for (let i = 0; i < windowDays; i++) {
    const dayStart = windowStartMs + i * DAY_MS
    const dayEnd = Math.min(dayStart + DAY_MS, nowMs)
    if (dayEnd <= dayStart) break // future day (window extends past `now`)

    let upMs = 0
    let totalMs = 0
    let worstRank = 0
    for (const seg of segments) {
      const overlapStart = Math.max(seg.start, dayStart)
      const overlapEnd = Math.min(seg.end, dayEnd)
      if (overlapEnd <= overlapStart) continue
      const duration = overlapEnd - overlapStart
      totalMs += duration
      if (UPTIME_STATUSES.has(seg.status)) upMs += duration
      const rank = SEVERITY_ORDER.indexOf(seg.status)
      if (rank > worstRank) worstRank = rank
    }

    days.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      worstStatus: SEVERITY_ORDER[worstRank],
      uptimePct: totalMs > 0 ? Math.round((upMs / totalMs) * 10000) / 100 : 100,
    })
  }
  return days
}
