/**
 * Quinn's operational metrics: what the runtime did, as opposed to what the
 * conversations became (QUINN-PRODUCT Step 11, P8).
 *
 * `quinn-performance.ts` next door answers the product question, involvement,
 * resolution, escalation and CSAT, from the involvement rows. This module answers
 * the operator's: how long work waited, how often it failed or was superseded,
 * how often an answer could not be supported, whether actions landed or went
 * unconfirmed, and whether approvals are being completed. Both read real rows
 * over the same range and neither has a rollup table, which is the
 * specification's own staging: aggregates come after the bounded queries are
 * measured to be expensive, not before.
 *
 * Every rate is `ratePctOrNull`, so an empty range reports null rather than
 * zero. A surface renders null as the same placeholder every other metric tile
 * uses and explains the next useful step; a zero would be a claim nobody made.
 *
 * The run rows are fetched and summarized in memory, following
 * `summarizeQuinnPerformance`: the volume is the same order, the rate maths is
 * then unit-testable without a database, and the shape of "what a run ended as"
 * is a vocabulary rather than an aggregate. Step timings are the exception and
 * are aggregated in SQL, because a percentile over every step of every run is
 * exactly what a database is for.
 */
import {
  db,
  and,
  gte,
  lt,
  sql,
  assistantPendingActions,
  assistantRuns,
  assistantToolCalls,
} from '@/lib/server/db'
import { ratePctOrNull } from '@/lib/shared/percent'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

/** One run, reduced to what the operational summary reads. */
export interface QuinnRunRow {
  status: string
  outcome: string | null
  disposition: string | null
  createdAt: Date | string
  startedAt: Date | string | null
  finishedAt: Date | string | null
}

export interface QuinnRunSummary {
  /** Runs created in the range. */
  runs: number
  /** Runs that published an outcome. */
  published: number
  /** Substantive supported answers, excluding greetings and handoffs. */
  answered: number
  /** Inability and clarification turns that did not answer the question. */
  unanswered: number
  /** Runs that ended in a failure, including the recovery sweep's. */
  failed: number
  /** Runs a newer input or a withdrawn authority replaced. */
  superseded: number
  /** Runs the engine decided had nothing to say. */
  suppressed: number
  /** Runs a person or a lifecycle change stopped. */
  cancelled: number
  /** Runs still open right now. Not a rate, a backlog. */
  open: number
  failureRate: number | null
  supersessionRate: number | null
  /**
   * Candidates a validator refused: an unsupported claim, a revoked citation,
   * a malformed answer. Read off the disposition the fence wrote, never guessed.
   */
  unsupported: number
  unsupportedRate: number | null
  /** Median and 95th percentile of intent-to-claim, in milliseconds. */
  queueToStartP50Ms: number | null
  queueToStartP95Ms: number | null
  /** Median of intent-to-settled. */
  totalP50Ms: number | null
}

const asDate = (value: Date | string | null): Date | null =>
  value === null ? null : value instanceof Date ? value : new Date(value)

/**
 * A discrete percentile: the smallest observed value at or above the fraction.
 *
 * Deliberately PostgreSQL's `percentile_disc` and not an interpolation, so the
 * in-memory run percentiles and the SQL step percentiles below answer the same
 * question, and so every number printed is a duration something actually took.
 */
function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index] ?? null
}

/** Pure: the rate maths and the vocabulary, with no database anywhere near it. */
export function summarizeQuinnRuns(rows: readonly QuinnRunRow[]): QuinnRunSummary {
  let published = 0
  let answered = 0
  let unanswered = 0
  let failed = 0
  let superseded = 0
  let suppressed = 0
  let cancelled = 0
  let open = 0
  let unsupported = 0
  const queueToStart: number[] = []
  const total: number[] = []

  for (const row of rows) {
    switch (row.status) {
      case 'succeeded':
        published += 1
        if (row.outcome === 'answer') answered += 1
        if (row.outcome === 'inability' || row.outcome === 'clarification') unanswered += 1
        break
      case 'failed':
        failed += 1
        break
      case 'superseded':
        superseded += 1
        break
      case 'suppressed':
        suppressed += 1
        break
      case 'cancelled':
        cancelled += 1
        break
      default:
        open += 1
    }
    // The validator writes its refusal into the disposition, so this counts the
    // fence's own decision rather than inferring one from the absence of text.
    if (row.disposition?.startsWith('validation:')) unsupported += 1

    const createdAt = asDate(row.createdAt)
    const startedAt = asDate(row.startedAt)
    const finishedAt = asDate(row.finishedAt)
    if (createdAt && startedAt) {
      const ms = startedAt.getTime() - createdAt.getTime()
      if (ms >= 0) queueToStart.push(ms)
    }
    if (createdAt && finishedAt) {
      const ms = finishedAt.getTime() - createdAt.getTime()
      if (ms >= 0) total.push(ms)
    }
  }

  const runs = rows.length
  return {
    runs,
    published,
    answered,
    unanswered,
    failed,
    superseded,
    suppressed,
    cancelled,
    open,
    failureRate: ratePctOrNull(failed, runs),
    supersessionRate: ratePctOrNull(superseded, runs),
    unsupported,
    unsupportedRate: ratePctOrNull(unsupported, runs),
    queueToStartP50Ms: percentile(queueToStart, 0.5),
    queueToStartP95Ms: percentile(queueToStart, 0.95),
    totalP50Ms: percentile(total, 0.5),
  }
}

/** Median duration of one kind of step, in milliseconds. */
export interface QuinnStepLatency {
  step: string
  runs: number
  p50Ms: number | null
}

export interface QuinnActionSummary {
  /** Receipts written in the range, whatever they settled as. */
  attempted: number
  succeeded: number
  failed: number
  /** Effects dispatched and never confirmed. The number a person owes a verdict on. */
  unknown: number
  denied: number
  successRate: number | null
  unknownRate: number | null
  /** Effects still awaiting somebody's verdict right now. */
  awaitingReconciliation: number
}

export interface QuinnApprovalSummary {
  proposed: number
  approved: number
  rejected: number
  expired: number
  executed: number
  /** decided / proposed: how much of the review queue is actually being worked. */
  decisionRate: number | null
  /** executed / approved: how much of what was approved actually landed. */
  completionRate: number | null
  /** Approved actions whose execution is still owed right now. */
  owed: number
}

export interface QuinnOperationsReport {
  runs: QuinnRunSummary
  steps: QuinnStepLatency[]
  actions: QuinnActionSummary
  approvals: QuinnApprovalSummary
}

/**
 * Median step duration per step key, over runs created in the range.
 *
 * Aggregated in SQL rather than in memory: this is one row per step of every
 * run, which is the one place the in-memory idiom next door stops paying.
 */
async function stepLatencies(from: Date, to: Date): Promise<QuinnStepLatency[]> {
  const result = await db.execute(sql`
    SELECT s.step_key AS step,
           count(*)::int AS runs,
           percentile_disc(0.5) WITHIN GROUP (
             ORDER BY EXTRACT(EPOCH FROM (s.finished_at - s.started_at)) * 1000
           )::int AS p50_ms
    FROM assistant_run_steps s
    JOIN assistant_runs r ON r.id = s.run_id
    WHERE r.created_at >= ${from.toISOString()}::timestamptz
      AND r.created_at < ${to.toISOString()}::timestamptz
      AND s.finished_at IS NOT NULL
    GROUP BY s.step_key
    ORDER BY s.step_key
  `)
  return getExecuteRows<{ step: string; runs: number; p50_ms: number | null }>(result).map(
    (row) => ({ step: row.step, runs: row.runs, p50Ms: row.p50_ms })
  )
}

async function actionSummary(from: Date, to: Date): Promise<QuinnActionSummary> {
  const [row] = await db
    .select({
      attempted: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) FILTER (WHERE coalesce(${assistantToolCalls.outcomeStatus}, ${assistantToolCalls.status}) = 'succeeded')::int`,
      failed: sql<number>`count(*) FILTER (WHERE coalesce(${assistantToolCalls.outcomeStatus}, ${assistantToolCalls.status}) = 'failed')::int`,
      unknown: sql<number>`count(*) FILTER (WHERE ${assistantToolCalls.outcomeStatus} = 'unknown')::int`,
      denied: sql<number>`count(*) FILTER (WHERE coalesce(${assistantToolCalls.outcomeStatus}, ${assistantToolCalls.status}) = 'denied')::int`,
    })
    .from(assistantToolCalls)
    .where(and(gte(assistantToolCalls.createdAt, from), lt(assistantToolCalls.createdAt, to)))

  const [owed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assistantToolCalls)
    .where(sql`${assistantToolCalls.reconciliationState} = 'required'`)

  const attempted = row?.attempted ?? 0
  return {
    attempted,
    succeeded: row?.succeeded ?? 0,
    failed: row?.failed ?? 0,
    unknown: row?.unknown ?? 0,
    denied: row?.denied ?? 0,
    successRate: ratePctOrNull(row?.succeeded ?? 0, attempted),
    unknownRate: ratePctOrNull(row?.unknown ?? 0, attempted),
    awaitingReconciliation: owed?.n ?? 0,
  }
}

async function approvalSummary(from: Date, to: Date): Promise<QuinnApprovalSummary> {
  const [row] = await db
    .select({
      proposed: sql<number>`count(*)::int`,
      approved: sql<number>`count(*) FILTER (WHERE ${assistantPendingActions.decidedAt} IS NOT NULL AND ${assistantPendingActions.status} <> 'rejected')::int`,
      rejected: sql<number>`count(*) FILTER (WHERE ${assistantPendingActions.status} = 'rejected')::int`,
      expired: sql<number>`count(*) FILTER (WHERE ${assistantPendingActions.status} = 'expired')::int`,
      executed: sql<number>`count(*) FILTER (WHERE ${assistantPendingActions.status} = 'executed')::int`,
      decided: sql<number>`count(*) FILTER (WHERE ${assistantPendingActions.decidedAt} IS NOT NULL)::int`,
    })
    .from(assistantPendingActions)
    .where(
      and(gte(assistantPendingActions.proposedAt, from), lt(assistantPendingActions.proposedAt, to))
    )

  const [owed] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assistantPendingActions)
    .where(
      sql`${assistantPendingActions.status} = 'approved' AND ${assistantPendingActions.executionState} IN ('queued', 'running')`
    )

  const proposed = row?.proposed ?? 0
  return {
    proposed,
    approved: row?.approved ?? 0,
    rejected: row?.rejected ?? 0,
    expired: row?.expired ?? 0,
    executed: row?.executed ?? 0,
    decisionRate: ratePctOrNull(row?.decided ?? 0, proposed),
    completionRate: ratePctOrNull(row?.executed ?? 0, row?.approved ?? 0),
    owed: owed?.n ?? 0,
  }
}

/** Query and summarize the operational picture over [from, to). */
export async function getQuinnOperations(from: Date, to: Date): Promise<QuinnOperationsReport> {
  const [runRows, steps, actions, approvals] = await Promise.all([
    db
      .select({
        status: assistantRuns.status,
        outcome: assistantRuns.outcome,
        disposition: assistantRuns.disposition,
        createdAt: assistantRuns.createdAt,
        startedAt: assistantRuns.startedAt,
        finishedAt: assistantRuns.finishedAt,
      })
      .from(assistantRuns)
      .where(and(gte(assistantRuns.createdAt, from), lt(assistantRuns.createdAt, to))),
    stepLatencies(from, to),
    actionSummary(from, to),
    approvalSummary(from, to),
  ])

  return { runs: summarizeQuinnRuns(runRows), steps, actions, approvals }
}
