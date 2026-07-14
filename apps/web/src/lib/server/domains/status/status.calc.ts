/**
 * Pure derivation functions for the Status page (Status Product Spec §5).
 * No DB access — unit-testable in isolation.
 *
 * The worst-of derivations (top-level status, impact) live in
 * `@/lib/shared/status-calc` so client composers can preview them without a
 * server round trip; this module re-exports them for domain callers and adds
 * the server-only uptime derivation.
 */
import type { StatusComponentStatus, StatusIncidentImpact } from '@/lib/server/db'
import type { UptimeDay } from './status.types'
import {
  SEVERITY_ORDER,
  deriveImpact,
  deriveTopLevelStatus,
  type StatusCalcComponentStatus,
  type StatusCalcImpact,
} from '@/lib/shared/status-calc'

export { deriveImpact, deriveTopLevelStatus }

// Compile-time pin: the shared module's literal unions must stay identical
// to the schema enums. A pgEnum change that isn't mirrored in
// lib/shared/status-calc.ts fails typecheck here.
const _componentStatusPin: readonly StatusComponentStatus[] = SEVERITY_ORDER
const _componentStatusPinReverse: readonly StatusCalcComponentStatus[] =
  [] as StatusComponentStatus[]
const _impactPin: StatusIncidentImpact = 'none' as StatusCalcImpact
const _impactPinReverse: StatusCalcImpact = 'none' as StatusIncidentImpact
void _componentStatusPin
void _componentStatusPinReverse
void _impactPin
void _impactPinReverse

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
