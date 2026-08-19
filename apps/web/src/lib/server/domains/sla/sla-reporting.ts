/**
 * SLA reporting (support platform §4.6, §7). Read-only aggregates over the
 * append-only sla_events ledger — the attainment metrics the support dashboard
 * shows. Four clocks are tracked: the conversation clocks (first response,
 * next response, time to close) and the ticket-anchored time-to-resolve clock
 * (whose events carry ticket_id with a NULL conversation_id). Attainment counts
 * only the `*_met` / `*_breached` settle events: `applied` rows mark clock
 * starts and `*_settled_after_breach` catch-ups feed time-after-miss, so both
 * are excluded from the met/breached counts.
 */
import { db, and, eq, gte, lt, count, inArray, sql, slaEvents, slaPolicies } from '@/lib/server/db'

export interface ClockAttainment {
  met: number
  breached: number
  /** met / (met + breached), or null when nothing was recorded. */
  rate: number | null
}

export interface SlaAttainment {
  firstResponse: ClockAttainment
  nextResponse: ClockAttainment
  resolution: ClockAttainment
  timeToResolve: ClockAttainment
}

/** The tracked clocks, mapped to their sla_events kind prefix. */
const CLOCKS = [
  { key: 'firstResponse', prefix: 'first_response' },
  { key: 'nextResponse', prefix: 'next_response' },
  { key: 'resolution', prefix: 'resolution' },
  { key: 'timeToResolve', prefix: 'time_to_resolve' },
] as const

type ClockKey = (typeof CLOCKS)[number]['key']

const metKind = (prefix: string) => `${prefix}_met`
const breachedKind = (prefix: string) => `${prefix}_breached`
const settledAfterBreachKind = (prefix: string) => `${prefix}_settled_after_breach`

const BREACH_KINDS = CLOCKS.map((c) => breachedKind(c.prefix))
const SETTLED_AFTER_BREACH_KINDS = CLOCKS.map((c) => settledAfterBreachKind(c.prefix))

function attainment(met: number, breached: number): ClockAttainment {
  const total = met + breached
  return { met, breached, rate: total === 0 ? null : met / total }
}

function emptyAttainment(): SlaAttainment {
  return {
    firstResponse: attainment(0, 0),
    nextResponse: attainment(0, 0),
    resolution: attainment(0, 0),
    timeToResolve: attainment(0, 0),
  }
}

/** Fold grouped (kind, n) rows into per-clock attainment. Unknown kinds
 *  (applied, *_settled_after_breach) match no lookup and are ignored. */
function foldAttainment(rows: { kind: string; n: number }[]): SlaAttainment {
  const n = (kind: string): number => rows.find((r) => r.kind === kind)?.n ?? 0
  const result = emptyAttainment()
  for (const clock of CLOCKS) {
    result[clock.key] = attainment(n(metKind(clock.prefix)), n(breachedKind(clock.prefix)))
  }
  return result
}

/** SLA attainment over [from, to). */
export async function slaAttainment(from: Date, to: Date): Promise<SlaAttainment> {
  const rows = await db
    .select({ kind: slaEvents.kind, n: count() })
    .from(slaEvents)
    .where(and(gte(slaEvents.at, from), lt(slaEvents.at, to)))
    .groupBy(slaEvents.kind)

  return foldAttainment(rows)
}

export interface PolicySlaAttainment extends SlaAttainment {
  policyId: string
  policyName: string
}

/** Per-policy SLA attainment over [from, to). The join to sla_policies is not
 *  filtered on deletedAt, so a soft-deleted policy keeps its name on the
 *  history it produced. Policies with no events in range are absent. */
export async function slaAttainmentByPolicy(from: Date, to: Date): Promise<PolicySlaAttainment[]> {
  const rows = await db
    .select({
      policyId: slaEvents.policyId,
      policyName: slaPolicies.name,
      kind: slaEvents.kind,
      n: count(),
    })
    .from(slaEvents)
    .innerJoin(slaPolicies, eq(slaEvents.policyId, slaPolicies.id))
    .where(and(gte(slaEvents.at, from), lt(slaEvents.at, to)))
    .groupBy(slaEvents.policyId, slaPolicies.name, slaEvents.kind)
    .orderBy(slaPolicies.name)

  const byPolicy = new Map<
    string,
    { policyId: string; policyName: string; rows: { kind: string; n: number }[] }
  >()
  for (const row of rows) {
    let entry = byPolicy.get(row.policyId)
    if (!entry) {
      entry = { policyId: row.policyId, policyName: row.policyName, rows: [] }
      byPolicy.set(row.policyId, entry)
    }
    entry.rows.push(row)
  }
  return [...byPolicy.values()].map(({ rows: grouped, ...entry }) => ({
    ...entry,
    ...foldAttainment(grouped),
  }))
}

export interface SlaBreachHeatmapCell {
  /** ISO day of week: 1 (Monday) - 7 (Sunday). */
  dow: number
  /** Hour of day, 0-23. */
  hour: number
  count: number
  /** Breach count per clock; clocks with none in the cell read 0. */
  byClock: Record<ClockKey, number>
}

/** Hourly distribution of missed SLA targets over [from, to) — the staffing
 *  view: when in the week do breaches land? Cells are bucketed by the `at`
 *  timestamp in UTC (`at time zone 'UTC'`), so bucketing is stable regardless
 *  of the connecting session's TimeZone; reporting has no workspace-timezone
 *  helper yet. Sparse: cells with no breaches are absent. */
export async function slaBreachHeatmap(from: Date, to: Date): Promise<SlaBreachHeatmapCell[]> {
  const dow = sql<number>`extract(isodow from (${slaEvents.at} at time zone 'UTC'))::int`
  const hour = sql<number>`extract(hour from (${slaEvents.at} at time zone 'UTC'))::int`
  const rows = await db
    .select({ dow, hour, kind: slaEvents.kind, n: count() })
    .from(slaEvents)
    .where(
      and(gte(slaEvents.at, from), lt(slaEvents.at, to), inArray(slaEvents.kind, BREACH_KINDS))
    )
    .groupBy(dow, hour, slaEvents.kind)

  const clockForKind = new Map(CLOCKS.map((c) => [breachedKind(c.prefix), c.key] as const))
  const cells = new Map<string, SlaBreachHeatmapCell>()
  for (const row of rows) {
    const key = `${row.dow}:${row.hour}`
    let cell = cells.get(key)
    if (!cell) {
      cell = {
        dow: row.dow,
        hour: row.hour,
        count: 0,
        byClock: { firstResponse: 0, nextResponse: 0, resolution: 0, timeToResolve: 0 },
      }
      cells.set(key, cell)
    }
    cell.count += row.n
    const clock = clockForKind.get(row.kind)
    if (clock) cell.byClock[clock] += row.n
  }
  return [...cells.values()].sort((a, b) => a.dow - b.dow || a.hour - b.hour)
}

export interface ClockTimeAfterMiss {
  /** Settle-after-breach events recorded in range. */
  count: number
  /** Average meta.overdueSecs across those events — the pause-adjusted lag
   *  from deadline to settle. Null when nothing settled after breach. */
  avgOverdueSecs: number | null
}

export interface SlaTimeAfterMiss {
  firstResponse: ClockTimeAfterMiss
  nextResponse: ClockTimeAfterMiss
  resolution: ClockTimeAfterMiss
  timeToResolve: ClockTimeAfterMiss
}

/** Average time-after-miss per clock over [from, to): how late settles land
 *  once a target was already missed, from the `*_settled_after_breach`
 *  events' meta.overdueSecs. */
export async function slaTimeAfterMiss(from: Date, to: Date): Promise<SlaTimeAfterMiss> {
  const rows = await db
    .select({
      kind: slaEvents.kind,
      n: count(),
      avgOverdueSecs: sql<number | null>`avg((${slaEvents.meta}->>'overdueSecs')::numeric)::float`,
    })
    .from(slaEvents)
    .where(
      and(
        gte(slaEvents.at, from),
        lt(slaEvents.at, to),
        inArray(slaEvents.kind, SETTLED_AFTER_BREACH_KINDS)
      )
    )
    .groupBy(slaEvents.kind)

  const result: SlaTimeAfterMiss = {
    firstResponse: { count: 0, avgOverdueSecs: null },
    nextResponse: { count: 0, avgOverdueSecs: null },
    resolution: { count: 0, avgOverdueSecs: null },
    timeToResolve: { count: 0, avgOverdueSecs: null },
  }
  for (const clock of CLOCKS) {
    const row = rows.find((r) => r.kind === settledAfterBreachKind(clock.prefix))
    if (row) result[clock.key] = { count: row.n, avgOverdueSecs: row.avgOverdueSecs }
  }
  return result
}
