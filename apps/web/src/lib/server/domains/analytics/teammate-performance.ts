/**
 * Pure per-teammate performance aggregation for the support analytics panel.
 * Kept separate from the SQL so the grouping and medians are unit-tested
 * directly. Conversation volume is low, so the caller selects one row per
 * assigned conversation in the period (with its first agent reply and close
 * timestamps) and hands them here — no rollup table needed.
 *
 * "Handled" means the conversation carries the teammate as its agent assignee
 * (conversations.assigned_agent_principal_id) and arrived in the period.
 * Unassigned conversations never reach this function (the caller's WHERE
 * drops them). Medians are computed over answered/closed conversations only:
 * a teammate whose threads are all still open reads null, not zero.
 */

export interface TeammatePerformanceRow {
  /** conversations.assigned_agent_principal_id. */
  agentId: string
  /** principal.display_name; null falls back to the agent id. */
  displayName: string | null
  avatarUrl: string | null
  /** Conversation arrival (conversations.created_at). */
  createdAt: string | Date
  /** First non-internal agent reply; null while unanswered. */
  firstResponseAt: string | Date | null
  /** Terminal-status timestamp (conversations.resolved_at); null while open. */
  closedAt: string | Date | null
}

export interface TeammatePerformance {
  agentId: string
  displayName: string
  avatarUrl: string | null
  /** Assigned conversations that arrived in the period. */
  handled: number
  /** Median minutes from arrival to first agent reply; null when none of the
   *  teammate's conversations in the period were answered. */
  medianFirstResponseMinutes: number | null
  /** Median minutes from arrival to close; null when none closed. */
  medianCloseMinutes: number | null
}

/** Continuous median (percentile_cont semantics): the two middle values of an
 *  even sample average rather than picking one. */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const minutesBetween = (from: string | Date, to: string | Date) =>
  (new Date(to).getTime() - new Date(from).getTime()) / 60_000

export function buildTeammatePerformance(rows: TeammatePerformanceRow[]): TeammatePerformance[] {
  const byAgent = new Map<
    string,
    {
      displayName: string | null
      avatarUrl: string | null
      handled: number
      firstResponseMinutes: number[]
      closeMinutes: number[]
    }
  >()

  for (const r of rows) {
    const entry = byAgent.get(r.agentId) ?? {
      displayName: r.displayName,
      avatarUrl: r.avatarUrl,
      handled: 0,
      firstResponseMinutes: [],
      closeMinutes: [],
    }
    entry.handled += 1
    if (r.firstResponseAt != null) {
      entry.firstResponseMinutes.push(minutesBetween(r.createdAt, r.firstResponseAt))
    }
    if (r.closedAt != null) {
      entry.closeMinutes.push(minutesBetween(r.createdAt, r.closedAt))
    }
    byAgent.set(r.agentId, entry)
  }

  return Array.from(byAgent.entries())
    .map(([agentId, e]) => ({
      agentId,
      displayName: e.displayName ?? agentId,
      avatarUrl: e.avatarUrl,
      handled: e.handled,
      medianFirstResponseMinutes: median(e.firstResponseMinutes),
      medianCloseMinutes: median(e.closeMinutes),
    }))
    .sort((a, b) => b.handled - a.handled)
}
