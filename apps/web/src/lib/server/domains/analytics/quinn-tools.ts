/** Action metrics for the Quinn performance area. */
import { db, and, gte, lt, sql, assistantToolCalls } from '@/lib/server/db'
import { ratePctOrNull } from '@/lib/shared/percent'

export interface QuinnToolMetric {
  toolName: string
  succeeded: number
  failed: number
  denied: number
  skippedDuplicate: number
  /** succeeded / (succeeded + failed + denied), 0-100; null when that total is zero (never NaN). */
  successRate: number | null
  /** Average latency (ms) of succeeded calls; null when there were none. */
  avgLatencyMs: number | null
}

interface ToolCallAggregateRow {
  toolName: string
  succeeded: number
  failed: number
  denied: number
  skippedDuplicate: number
  avgLatencyMs: number | null
}

function toMetric(row: ToolCallAggregateRow): QuinnToolMetric {
  const attempted = row.succeeded + row.failed + row.denied
  return {
    toolName: row.toolName,
    succeeded: row.succeeded,
    failed: row.failed,
    denied: row.denied,
    skippedDuplicate: row.skippedDuplicate,
    successRate: ratePctOrNull(row.succeeded, attempted),
    avgLatencyMs: row.avgLatencyMs == null ? null : Math.round(row.avgLatencyMs),
  }
}

/**
 * Per-tool action counts over [from, to): one grouped scan of
 * assistant_tool_calls with a FILTER-per-status count plus the succeeded
 * calls' average latency, sorted by total calls descending (most-used tools
 * first).
 */
export async function getQuinnToolMetrics(from: Date, to: Date): Promise<QuinnToolMetric[]> {
  const rows = await db
    .select({
      toolName: assistantToolCalls.toolName,
      succeeded: sql<number>`count(*) filter (where ${assistantToolCalls.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${assistantToolCalls.status} = 'failed')::int`,
      denied: sql<number>`count(*) filter (where ${assistantToolCalls.status} = 'denied')::int`,
      skippedDuplicate: sql<number>`count(*) filter (where ${assistantToolCalls.status} = 'skipped_duplicate')::int`,
      avgLatencyMs: sql<
        number | null
      >`avg(${assistantToolCalls.latencyMs}) filter (where ${assistantToolCalls.status} = 'succeeded')`,
    })
    .from(assistantToolCalls)
    .where(and(gte(assistantToolCalls.createdAt, from), lt(assistantToolCalls.createdAt, to)))
    .groupBy(assistantToolCalls.toolName)

  return rows.map(toMetric).sort((a, b) => {
    const totalA = a.succeeded + a.failed + a.denied + a.skippedDuplicate
    const totalB = b.succeeded + b.failed + b.denied + b.skippedDuplicate
    return totalB - totalA || a.toolName.localeCompare(b.toolName)
  })
}
