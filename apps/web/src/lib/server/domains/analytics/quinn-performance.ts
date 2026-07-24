/**
 * Quinn performance summary — the "Analyze" headline for the AI assistant
 * (mirrors Fin's Analyze summary): involvement, resolution, and escalation
 * rates, the confirmed-vs-assumed resolution split, and actions taken via
 * tool calls, over a date range. Involvement volume is low (like CSAT — see
 * csat-summary.ts), so the caller selects the raw involvement rows for the
 * range with a plain query and hands them here; the rate math and the daily
 * trend are unit-tested directly, no materialized rollup needed.
 */
import { AI_INBOX_BUCKETS } from '@/lib/server/domains/assistant/assistant.involvement'
import {
  db,
  and,
  gte,
  lt,
  eq,
  sql,
  assistantInvolvements,
  assistantToolCalls,
  conversations,
  type AssistantInvolvementStatus,
} from '@/lib/server/db'
import { ratePctOrNull } from '@/lib/shared/percent'

export interface QuinnInvolvementRow {
  status: AssistantInvolvementStatus
  handoffReason: string | null
  createdAt: string | Date
}

export interface QuinnPerformanceSummary {
  /** Involvements opened in the range. */
  involvements: number
  /** Conversations created in the range — the involvement-rate denominator. */
  conversations: number
  /** involvements / conversations, 0-100; 0 when there were no conversations. */
  involvementRate: number
  /** Resolved via explicit customer affirmation. */
  resolvedConfirmed: number
  /** Resolved via inactivity after a real answer (no explicit affirmation). */
  resolvedAssumed: number
  /** (resolvedConfirmed + resolvedAssumed) / involvements, 0-100. */
  resolutionRate: number
  /** Handed off to a human by Quinn's own judgment (excludes system errors). */
  handedOff: number
  /** Handed off by the failure floor after a hard turn failure — an infra
   *  reliability signal, kept out of the quality-facing escalation rate. */
  systemErrors: number
  /** handedOff / involvements, 0-100. */
  escalationRate: number
  /** Successful assistant_tool_calls in the range. */
  actionsTaken: number
  /** Involvements opened + resolved per UTC day, ascending by date. */
  dailyTrend: Array<{ date: string; involvements: number; resolved: number }>
}

const isResolved = (status: AssistantInvolvementStatus): boolean =>
  (AI_INBOX_BUCKETS.resolved as readonly AssistantInvolvementStatus[]).includes(status)

const isHandedOff = (status: AssistantInvolvementStatus): boolean =>
  (AI_INBOX_BUCKETS.escalated as readonly AssistantInvolvementStatus[]).includes(status)

// Quinn's rate tiles always render a number rather than a placeholder, so this
// coalesces the shared helper's null (nothing to divide by) down to 0 — unlike
// guidance-stats.ts and quinn-tools.ts, which surface that "no data yet" case
// to the UI as null.
const pct = (n: number, d: number): number => ratePctOrNull(n, d) ?? 0

export function summarizeQuinnPerformance(
  involvementRows: QuinnInvolvementRow[],
  conversations: number,
  actionsTaken: number
): QuinnPerformanceSummary {
  let resolvedConfirmed = 0
  let resolvedAssumed = 0
  let handedOff = 0
  let systemErrors = 0
  const byDay = new Map<string, { involvements: number; resolved: number }>()

  for (const row of involvementRows) {
    if (row.status === 'resolved_confirmed') resolvedConfirmed++
    else if (row.status === 'resolved_assumed') resolvedAssumed++
    // A failure-floor handoff measures the platform, not Quinn's judgment:
    // counted separately so a provider outage cannot masquerade as Quinn
    // getting worse at answering.
    else if (isHandedOff(row.status) && row.handoffReason === 'system_error') systemErrors++
    else if (isHandedOff(row.status)) handedOff++

    const date = new Date(row.createdAt).toISOString().slice(0, 10)
    const day = byDay.get(date) ?? { involvements: 0, resolved: 0 }
    day.involvements++
    if (isResolved(row.status)) day.resolved++
    byDay.set(date, day)
  }

  const involvements = involvementRows.length
  const resolved = resolvedConfirmed + resolvedAssumed

  const dailyTrend = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, day]) => ({ date, ...day }))

  return {
    involvements,
    conversations,
    involvementRate: pct(involvements, conversations),
    resolvedConfirmed,
    resolvedAssumed,
    resolutionRate: pct(resolved, involvements),
    handedOff,
    systemErrors,
    escalationRate: pct(handedOff, involvements),
    actionsTaken,
    dailyTrend,
  }
}

/**
 * Query + summarize Quinn's performance over [from, to). Three independent
 * scans over the range (involvements, conversation count, succeeded tool
 * calls) — low volume, like CSAT, so no rollup table; the grouping and rate
 * math happen in memory in `summarizeQuinnPerformance` above.
 */
export async function getQuinnPerformance(from: Date, to: Date): Promise<QuinnPerformanceSummary> {
  const [involvementRows, conversationCountRows, actionRows] = await Promise.all([
    db
      .select({
        status: assistantInvolvements.status,
        handoffReason: assistantInvolvements.handoffReason,
        createdAt: assistantInvolvements.createdAt,
      })
      .from(assistantInvolvements)
      .where(
        and(gte(assistantInvolvements.createdAt, from), lt(assistantInvolvements.createdAt, to))
      ),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(conversations)
      .where(and(gte(conversations.createdAt, from), lt(conversations.createdAt, to))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(assistantToolCalls)
      .where(
        and(
          eq(assistantToolCalls.status, 'succeeded'),
          gte(assistantToolCalls.createdAt, from),
          lt(assistantToolCalls.createdAt, to)
        )
      ),
  ])

  return summarizeQuinnPerformance(
    involvementRows,
    conversationCountRows[0]?.n ?? 0,
    actionRows[0]?.n ?? 0
  )
}
