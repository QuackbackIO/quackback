/**
 * Tools & connectors metrics for the "Tools and connectors" section of the
 * Quinn performance area: per-tool action counts from assistant_tool_calls,
 * and connector health from data_connectors. Tool volume is low (like the
 * rest of Quinn performance — see quinn-performance.ts), so the per-tool
 * breakdown is one grouped scan with a conditional (FILTER) count per status
 * rather than a materialized rollup; adding a status never costs another
 * round trip. Connector health is a plain read — connectors are admin-defined
 * and low in number.
 *
 * `connectorHealthStatus` here is a coarse three-tier summary
 * (healthy/degraded/unhealthy) for this glance-level reporting card. It's
 * deliberately simpler than the five-label badge in
 * components/admin/automation/connectors/connector-health.ts, which drives
 * the connector management table and needs the finer Issues/Failing
 * distinction an admin fixing a specific connector wants.
 */
import {
  db,
  and,
  gte,
  lt,
  sql,
  assistantToolCalls,
  dataConnectors,
  type ConnectorStatus,
} from '@/lib/server/db'
import type { DataConnectorId } from '@quackback/ids'
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

export type ConnectorHealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface ConnectorHealth {
  id: DataConnectorId
  name: string
  enabled: boolean
  status: ConnectorStatus
  failureCount: number
  lastError: string | null
  healthStatus: ConnectorHealthStatus
}

/** disabled means the circuit breaker has tripped (or an admin disabled it
 *  outright) — either way the connector isn't callable, so it's unhealthy.
 *  Any failures while still active are a degradation worth flagging; zero
 *  failures is healthy. */
export function connectorHealthStatus(
  status: ConnectorStatus,
  failureCount: number
): ConnectorHealthStatus {
  if (status === 'disabled') return 'unhealthy'
  if (failureCount > 0) return 'degraded'
  return 'healthy'
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

/** Connector health for the admin-defined data connectors: enabled/status/
 *  failureCount/lastError plus the derived Healthy/Degraded/Unhealthy tier. */
export async function getConnectorHealth(): Promise<ConnectorHealth[]> {
  const rows = await db
    .select({
      id: dataConnectors.id,
      name: dataConnectors.name,
      enabled: dataConnectors.enabled,
      status: dataConnectors.status,
      failureCount: dataConnectors.failureCount,
      lastError: dataConnectors.lastError,
    })
    .from(dataConnectors)
    .orderBy(dataConnectors.name)

  return rows.map((row) => ({
    ...row,
    healthStatus: connectorHealthStatus(row.status, row.failureCount),
  }))
}
