/**
 * Real-DB coverage for per-action status counts and success-rate/latency math.
 * Runs inside the db-test-fixture rollback transaction. Tool names are prefixed
 * to avoid colliding with rows already committed in a shared dev DB.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantToolCalls } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { getQuinnToolMetrics } from '../quinn-tools'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantToolCalls.id }).from(assistantToolCalls).limit(0)
  },
})

const FROM = new Date('2026-06-01T00:00:00Z')
const TO = new Date('2026-07-01T00:00:00Z')

type ToolCallStatus = 'started' | 'succeeded' | 'failed' | 'denied' | 'skipped_duplicate'

async function seedToolCall(overrides: {
  toolName: string
  status: ToolCallStatus
  latencyMs?: number | null
  createdAt?: Date
}) {
  await testDb.insert(assistantToolCalls).values({
    toolName: overrides.toolName,
    args: {},
    status: overrides.status,
    latencyMs: overrides.latencyMs ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-06-15T00:00:00Z'),
  })
}

describe.skipIf(!fixture.available)('quinn-tools (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('getQuinnToolMetrics', () => {
    it('counts calls per tool by status over the range', async () => {
      await seedToolCall({ toolName: '__qtt_search_kb', status: 'succeeded' })
      await seedToolCall({ toolName: '__qtt_search_kb', status: 'succeeded' })
      await seedToolCall({ toolName: '__qtt_search_kb', status: 'failed' })
      await seedToolCall({ toolName: '__qtt_search_kb', status: 'denied' })
      await seedToolCall({ toolName: '__qtt_search_kb', status: 'skipped_duplicate' })

      const metrics = await getQuinnToolMetrics(FROM, TO)
      const tool = metrics.find((m) => m.toolName === '__qtt_search_kb')
      expect(tool).toMatchObject({
        toolName: '__qtt_search_kb',
        succeeded: 2,
        failed: 1,
        denied: 1,
        skippedDuplicate: 1,
      })
    })

    it('computes success rate as succeeded / (succeeded + failed + denied)', async () => {
      await seedToolCall({ toolName: '__qtt_close_conversation', status: 'succeeded' })
      await seedToolCall({ toolName: '__qtt_close_conversation', status: 'succeeded' })
      await seedToolCall({ toolName: '__qtt_close_conversation', status: 'succeeded' })
      await seedToolCall({ toolName: '__qtt_close_conversation', status: 'failed' })

      const metrics = await getQuinnToolMetrics(FROM, TO)
      const tool = metrics.find((m) => m.toolName === '__qtt_close_conversation')
      expect(tool?.successRate).toBe(75)
    })

    it('reports a null success rate, not NaN, when there are no succeeded/failed/denied calls', async () => {
      await seedToolCall({ toolName: '__qtt_refund_charge', status: 'skipped_duplicate' })

      const metrics = await getQuinnToolMetrics(FROM, TO)
      const tool = metrics.find((m) => m.toolName === '__qtt_refund_charge')
      expect(tool?.successRate).toBeNull()
    })

    it('averages latency across succeeded calls only', async () => {
      await seedToolCall({ toolName: '__qtt_lookup_order', status: 'succeeded', latencyMs: 100 })
      await seedToolCall({ toolName: '__qtt_lookup_order', status: 'succeeded', latencyMs: 300 })
      await seedToolCall({ toolName: '__qtt_lookup_order', status: 'failed', latencyMs: 5000 })

      const metrics = await getQuinnToolMetrics(FROM, TO)
      const tool = metrics.find((m) => m.toolName === '__qtt_lookup_order')
      expect(tool?.avgLatencyMs).toBe(200)
    })

    it('reports a null avg latency when there were no succeeded calls', async () => {
      await seedToolCall({ toolName: '__qtt_escalate', status: 'failed', latencyMs: 50 })

      const metrics = await getQuinnToolMetrics(FROM, TO)
      const tool = metrics.find((m) => m.toolName === '__qtt_escalate')
      expect(tool?.avgLatencyMs).toBeNull()
    })

    it('excludes calls outside the range', async () => {
      await seedToolCall({
        toolName: '__qtt_outside_range',
        status: 'succeeded',
        createdAt: new Date('2026-05-01T00:00:00Z'),
      })

      const metrics = await getQuinnToolMetrics(FROM, TO)
      expect(metrics.find((m) => m.toolName === '__qtt_outside_range')).toBeUndefined()
    })

    it('sorts tools by total calls descending', async () => {
      await seedToolCall({ toolName: '__qtt_zzz_low_volume', status: 'succeeded' })
      await seedToolCall({ toolName: '__qtt_aaa_high_volume', status: 'succeeded' })
      await seedToolCall({ toolName: '__qtt_aaa_high_volume', status: 'succeeded' })
      await seedToolCall({ toolName: '__qtt_aaa_high_volume', status: 'failed' })

      const metrics = await getQuinnToolMetrics(FROM, TO)
      const names = metrics.map((m) => m.toolName)
      expect(names.indexOf('__qtt_aaa_high_volume')).toBeLessThan(
        names.indexOf('__qtt_zzz_low_volume')
      )
    })
  })
})
