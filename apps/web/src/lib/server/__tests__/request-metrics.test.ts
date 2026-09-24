/**
 * Per-request work counters.
 *
 * The counter must follow the request across the child scopes the app opens
 * inside it (a workspace scope copies the parent context into a new object),
 * and must never leak into a line of the structured log.
 */
import { describe, it, expect } from 'vitest'
import {
  countingQueryLogger,
  currentRequestMetrics,
  formatServerTiming,
  openRequestMetrics,
} from '../request-metrics'
import { getLogContext, runWithLogContext } from '@/lib/server/log-context'
import { createLogger } from '@/lib/server/logger'

function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  return runWithLogContext({ request_id: 'r1' }, () => {
    openRequestMetrics()
    return fn()
  })
}

describe('request metrics', () => {
  it('counts every query the drizzle logger sees inside the request', async () => {
    const metrics = await inRequest(async () => {
      countingQueryLogger.logQuery('select 1', [])
      countingQueryLogger.logQuery('select 2', [])
      return currentRequestMetrics()
    })
    expect(metrics?.dbQueries).toBe(2)
  })

  it('keeps counting into the parent after a child scope copies the context', async () => {
    const metrics = await inRequest(async () => {
      countingQueryLogger.logQuery('select 1', [])
      // runWithWorkspaceScope builds its child exactly like this.
      const child = { ...getLogContext()!, workspace_key: 'ws' }
      await runWithLogContext(child, async () => {
        countingQueryLogger.logQuery('select 2', [])
      })
      return currentRequestMetrics()
    })
    expect(metrics?.dbQueries).toBe(2)
  })

  it('is a no-op outside a request', () => {
    expect(openRequestMetrics()).toBeUndefined()
    expect(() => countingQueryLogger.logQuery('select 1', [])).not.toThrow()
    expect(currentRequestMetrics()).toBeUndefined()
  })

  it('never writes the counter into log lines', async () => {
    const lines: string[] = []
    const log = createLogger({ level: 'info', destination: { write: (s) => void lines.push(s) } })
    await inRequest(async () => {
      countingQueryLogger.logQuery('select 1', [])
      log.info('hello')
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain('dbQueries')
  })
})

describe('formatServerTiming', () => {
  it('reports total time and query count', () => {
    expect(formatServerTiming({ dbQueries: 7 }, 12.345)).toBe('app;dur=12.3, db;desc="7 queries"')
  })
})
