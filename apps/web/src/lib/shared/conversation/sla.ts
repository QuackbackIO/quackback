/**
 * Client-safe SLA display logic: the countdown thresholds for the inbox chip
 * and compact target formatting for the settings page. Pure functions over
 * ConversationSlaDTO so the admin bundle, the settings page, and tests share
 * one source of truth.
 */
import type { ConversationSlaDTO, ConversationStatus } from './types'

const MINUTE_MS = 60_000

export type SlaTargetKind = 'first_response' | 'next_response' | 'close'

export const SLA_TARGET_LABELS: Record<SlaTargetKind, string> = {
  first_response: 'first response',
  next_response: 'next response',
  close: 'time to close',
}

/**
 * The nearest unmet target's absolute deadline, or null when every tracked
 * clock is settled (nothing left to count down).
 */
export function nextSlaDue(sla: ConversationSlaDTO): { kind: SlaTargetKind; dueAt: Date } | null {
  const candidates: { kind: SlaTargetKind; dueAt: Date }[] = []
  if (sla.firstResponseDueAt && !sla.firstResponseAt) {
    candidates.push({ kind: 'first_response', dueAt: new Date(sla.firstResponseDueAt) })
  }
  if (sla.nextResponseDueAt) {
    candidates.push({ kind: 'next_response', dueAt: new Date(sla.nextResponseDueAt) })
  }
  if (sla.timeToCloseDueAt && !sla.resolvedAt) {
    candidates.push({ kind: 'close', dueAt: new Date(sla.timeToCloseDueAt) })
  }
  if (candidates.length === 0) return null
  return candidates.reduce((min, c) => (c.dueAt < min.dueAt ? c : min))
}

/** Chip urgency: grey with >15m left, yellow under 15m, orange under 5m, red
 *  once overdue; paused while a snoozed conversation's policy pauses. */
export type SlaChipTone = 'ok' | 'due_soon' | 'due_now' | 'overdue' | 'paused'

export interface SlaChipState {
  tone: SlaChipTone
  label: string
  kind: SlaTargetKind
}

const DUE_SOON_MS = 15 * MINUTE_MS
const DUE_NOW_MS = 5 * MINUTE_MS

/** The chip to render for a conversation's active SLA, or null when every
 *  tracked clock is settled (no chip). */
export function slaChipState(
  sla: ConversationSlaDTO,
  status: ConversationStatus,
  now: Date
): SlaChipState | null {
  const next = nextSlaDue(sla)
  if (!next) return null
  if (status === 'snoozed' && sla.pauseOnSnooze) {
    return { tone: 'paused', label: 'paused', kind: next.kind }
  }
  const remaining = next.dueAt.getTime() - now.getTime()
  if (remaining < 0) {
    return { tone: 'overdue', label: `${formatSlaCountdown(-remaining)} over`, kind: next.kind }
  }
  const tone = remaining <= DUE_NOW_MS ? 'due_now' : remaining <= DUE_SOON_MS ? 'due_soon' : 'ok'
  return { tone, label: formatSlaCountdown(remaining), kind: next.kind }
}

/**
 * The same urgency ladder as `slaChipState`, for a bare countdown that carries
 * no policy/target metadata to build a full `ConversationSlaDTO` from — e.g. a
 * ticket's `dueAt` (see `TicketDueChip` in inbox-detail-panel.tsx). `remainingMs`
 * negative means overdue.
 */
export function dueCountdownTone(remainingMs: number): SlaChipTone {
  if (remainingMs < 0) return 'overdue'
  if (remainingMs <= DUE_NOW_MS) return 'due_now'
  if (remainingMs <= DUE_SOON_MS) return 'due_soon'
  return 'ok'
}

/** Compact remaining/elapsed time: "3d 4h", "4h 10m", "12m", "<1m". */
export function formatSlaCountdown(ms: number): string {
  if (ms < MINUTE_MS) return '<1m'
  const totalMinutes = Math.floor(ms / MINUTE_MS)
  const d = Math.floor(totalMinutes / 1440)
  const h = Math.floor((totalMinutes % 1440) / 60)
  const m = totalMinutes % 60
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

/** A stored target rendered in its exact largest unit ("4h", "3d", "90m"). */
export function formatSlaTarget(secs: number): string {
  if (secs % 86400 === 0) return `${secs / 86400}d`
  if (secs % 3600 === 0) return `${secs / 3600}h`
  if (secs % 60 === 0) return `${secs / 60}m`
  return `${secs}s`
}

/** One-line targets summary for policy rows and the workflow picker:
 *  "First response 4h · next response 8h · close 3d · resolve 5d" (set targets
 *  only). `timeToResolveTargetSecs` is optional so three-target literals keep
 *  typechecking; the resolve part only appears when the ticket clock is set. */
export function slaTargetsSummary(policy: {
  firstResponseTargetSecs: number | null
  nextResponseTargetSecs: number | null
  timeToCloseTargetSecs: number | null
  timeToResolveTargetSecs?: number | null
}): string {
  const parts: string[] = []
  if (policy.firstResponseTargetSecs) {
    parts.push(`first response ${formatSlaTarget(policy.firstResponseTargetSecs)}`)
  }
  if (policy.nextResponseTargetSecs) {
    parts.push(`next response ${formatSlaTarget(policy.nextResponseTargetSecs)}`)
  }
  if (policy.timeToCloseTargetSecs) {
    parts.push(`close ${formatSlaTarget(policy.timeToCloseTargetSecs)}`)
  }
  if (policy.timeToResolveTargetSecs) {
    parts.push(`resolve ${formatSlaTarget(policy.timeToResolveTargetSecs)}`)
  }
  if (parts.length === 0) return 'No targets'
  const joined = parts.join(' · ')
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}
