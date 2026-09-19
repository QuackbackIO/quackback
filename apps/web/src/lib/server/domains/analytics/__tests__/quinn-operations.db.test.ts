/**
 * The operational report reads real rows (QUINN-PRODUCT Step 11, P8).
 *
 * The pure summary next door proves the maths. This proves the queries: that a
 * workspace with nothing reports nothing rather than zeroes, and that a
 * workspace with real runs, receipts and proposals reports what is actually in
 * the tables, over the range it was asked about and no wider.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantPendingActions,
  assistantRunSteps,
  assistantRuns,
  assistantToolCalls,
  conversations,
  principal,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { getQuinnOperations } from '../quinn-operations'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantRuns.id }).from(assistantRuns).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const FROM = new Date('2026-03-01T00:00:00.000Z')
const TO = new Date('2026-03-08T00:00:00.000Z')
const inRange = (offsetMs: number) => new Date(FROM.getTime() + offsetMs)

async function seedConversation(): Promise<ConversationId> {
  const [who] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [row] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: who.id as PrincipalId, channel: 'messenger' })
    .returning()
  return row.id
}

describe.skipIf(!fixture.available)('getQuinnOperations', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('reports nothing, not zero, for a range with no work in it', async () => {
    const report = await getQuinnOperations(FROM, TO)
    expect(report.runs.runs).toBe(0)
    expect(report.runs.failureRate).toBeNull()
    expect(report.runs.queueToStartP50Ms).toBeNull()
    expect(report.steps).toEqual([])
    expect(report.actions.successRate).toBeNull()
    expect(report.approvals.completionRate).toBeNull()
  })

  it('counts the runs, the step timings, the receipts and the proposals it can see', async () => {
    const conversationId = await seedConversation()
    const [published] = await testDb
      .insert(assistantRuns)
      .values({
        conversationId,
        surface: 'widget',
        triggerKind: 'customer_message',
        triggerKey: `ops-ok-${suffix()}`,
        status: 'succeeded',
        createdAt: inRange(0),
        startedAt: inRange(2_000),
        finishedAt: inRange(9_000),
      })
      .returning()
    await testDb.insert(assistantRuns).values({
      conversationId,
      surface: 'widget',
      triggerKind: 'customer_message',
      triggerKey: `ops-refused-${suffix()}`,
      status: 'suppressed',
      disposition: 'validation:unsupported',
      createdAt: inRange(1_000),
      startedAt: inRange(2_000),
      finishedAt: inRange(4_000),
    })
    await testDb.insert(assistantRunSteps).values({
      runId: published.id,
      stepKey: 'generate',
      stepKind: 'generation',
      status: 'succeeded',
      startedAt: inRange(2_000),
      finishedAt: inRange(6_000),
    })
    await testDb.insert(assistantToolCalls).values([
      {
        conversationId,
        runId: published.id,
        toolName: 'create_ticket',
        args: {},
        status: 'succeeded',
        outcomeStatus: 'succeeded',
        createdAt: inRange(5_000),
      },
      {
        conversationId,
        runId: published.id,
        toolName: 'create_ticket',
        args: {},
        status: 'started',
        outcomeStatus: 'unknown',
        reconciliationState: 'required',
        dispatchedAt: inRange(6_000),
        createdAt: inRange(6_000),
      },
    ])
    await testDb.insert(assistantPendingActions).values([
      {
        conversationId,
        toolName: 'create_ticket',
        args: {},
        summary: 'one',
        status: 'executed',
        proposedAt: inRange(1_000),
        decidedAt: inRange(2_000),
        expiresAt: inRange(90_000_000),
      },
      {
        conversationId,
        toolName: 'create_ticket',
        args: {},
        summary: 'two',
        status: 'proposed',
        proposedAt: inRange(3_000),
        expiresAt: inRange(90_000_000),
      },
    ])

    const report = await getQuinnOperations(FROM, TO)

    expect(report.runs.runs).toBe(2)
    expect(report.runs.published).toBe(1)
    expect(report.runs.unsupported).toBe(1)
    expect(report.runs.unsupportedRate).toBe(50)
    // Two runs waited 2s and 1s; percentile_disc(0.5) is the lower of the pair.
    expect(report.runs.queueToStartP50Ms).toBe(1_000)
    expect(report.steps).toEqual([{ step: 'generate', runs: 1, p50Ms: 4_000 }])
    expect(report.actions.attempted).toBe(2)
    expect(report.actions.succeeded).toBe(1)
    expect(report.actions.unknown).toBe(1)
    expect(report.actions.unknownRate).toBe(50)
    expect(report.actions.awaitingReconciliation).toBe(1)
    expect(report.approvals.proposed).toBe(2)
    expect(report.approvals.approved).toBe(1)
    expect(report.approvals.executed).toBe(1)
    expect(report.approvals.decisionRate).toBe(50)
    expect(report.approvals.completionRate).toBe(100)
  })

  it('leaves work outside the range out of every count', async () => {
    const conversationId = await seedConversation()
    await testDb.insert(assistantRuns).values({
      conversationId,
      surface: 'widget',
      triggerKind: 'customer_message',
      triggerKey: `ops-old-${suffix()}`,
      status: 'failed',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      startedAt: new Date('2026-01-01T00:00:01.000Z'),
      finishedAt: new Date('2026-01-01T00:00:02.000Z'),
    })
    await testDb.insert(assistantToolCalls).values({
      conversationId,
      toolName: 'create_ticket',
      args: {},
      status: 'succeeded',
      outcomeStatus: 'succeeded',
      createdAt: new Date('2026-01-01T00:00:02.000Z'),
    })

    const report = await getQuinnOperations(FROM, TO)
    expect(report.runs.runs).toBe(0)
    expect(report.actions.attempted).toBe(0)
  })
})
