/**
 * Retention and deletion for Quinn's run history (QUINN-PRODUCT Step 11, P8).
 *
 * Two obligations, proved separately. The window: run steps and run evidence
 * are reclaimed once they are old enough that nobody will read them, and
 * nothing inside the window is touched. The deletion: erasing a customer's
 * history takes every trace of Quinn's work on it, which is a property of the
 * foreign keys rather than of a cleanup pass somebody has to remember to call,
 * so it is asserted against a real cascade.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { AssistantRunId, ConversationId, PrincipalId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantRegressionCases,
  assistantRunEvidence,
  assistantRunSteps,
  assistantRuns,
  assistantToolCalls,
  conversationMessages,
  conversations,
  principal,
  eq,
} from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  ASSISTANT_RUN_HISTORY_RETENTION_DAYS,
  sweepExpiredAssistantRunHistory,
} from '../assistant-run-retention'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantRunSteps.id }).from(assistantRunSteps).limit(0)
  },
})

const suffix = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000)

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

async function seedRun(conversationId: ConversationId) {
  const [row] = await testDb
    .insert(assistantRuns)
    .values({
      conversationId,
      surface: 'widget',
      triggerKind: 'customer_message',
      triggerKey: `retention-${suffix()}`,
      status: 'succeeded',
    })
    .returning()
  return row
}

async function seedStep(runId: AssistantRunId, startedAt: Date, stepKey = `step-${suffix()}`) {
  const [row] = await testDb
    .insert(assistantRunSteps)
    .values({ runId, stepKey, stepKind: 'generation', status: 'succeeded', startedAt })
    .returning()
  return row
}

async function seedEvidence(runId: AssistantRunId, createdAt: Date) {
  const [row] = await testDb
    .insert(assistantRunEvidence)
    .values({
      runId,
      sourceType: 'article',
      sourceId: `article_${suffix()}`,
      passage: 'a passage handed to the model',
      createdAt,
    })
    .returning()
  return row
}

async function countSteps(id: (typeof assistantRunSteps.$inferSelect)['id']) {
  const rows = await testDb.select().from(assistantRunSteps).where(eq(assistantRunSteps.id, id))
  return rows.length
}

async function countEvidence(id: (typeof assistantRunEvidence.$inferSelect)['id']) {
  const rows = await testDb
    .select()
    .from(assistantRunEvidence)
    .where(eq(assistantRunEvidence.id, id))
  return rows.length
}

describe.skipIf(!fixture.available)('sweepExpiredAssistantRunHistory', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('reclaims steps and evidence past the window', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId)
    const step = await seedStep(run.id, daysAgo(ASSISTANT_RUN_HISTORY_RETENTION_DAYS + 1))
    const evidence = await seedEvidence(run.id, daysAgo(ASSISTANT_RUN_HISTORY_RETENTION_DAYS + 1))

    const result = await sweepExpiredAssistantRunHistory()

    expect(result.steps).toBeGreaterThanOrEqual(1)
    expect(result.evidence).toBeGreaterThanOrEqual(1)
    expect(await countSteps(step.id)).toBe(0)
    expect(await countEvidence(evidence.id)).toBe(0)
  })

  it('leaves everything inside the window alone', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId)
    const step = await seedStep(run.id, daysAgo(ASSISTANT_RUN_HISTORY_RETENTION_DAYS - 1))
    const evidence = await seedEvidence(run.id, daysAgo(ASSISTANT_RUN_HISTORY_RETENTION_DAYS - 1))

    await sweepExpiredAssistantRunHistory()

    expect(await countSteps(step.id)).toBe(1)
    expect(await countEvidence(evidence.id)).toBe(1)
  })

  it('keeps the run itself, which is the outcome record the reporting reads', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId)
    await seedStep(run.id, daysAgo(ASSISTANT_RUN_HISTORY_RETENTION_DAYS + 5))

    await sweepExpiredAssistantRunHistory()

    const rows = await testDb.select().from(assistantRuns).where(eq(assistantRuns.id, run.id))
    expect(rows).toHaveLength(1)
  })

  it('works a backlog down in batches', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId)
    for (let i = 0; i < 5; i += 1) {
      await seedStep(run.id, daysAgo(ASSISTANT_RUN_HISTORY_RETENTION_DAYS + 2), `batched-${i}`)
    }

    const result = await sweepExpiredAssistantRunHistory({ batchSize: 2 })
    expect(result.steps).toBeGreaterThanOrEqual(5)
  })
})

describe.skipIf(!fixture.available)("deleting a customer's history", () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  // close() is called once, from the last describe in this file: the fixture is
  // module-global and shared with the retention block above.
  afterAll(fixture.close)

  it('takes every Quinn record of that conversation with it', async () => {
    const conversationId = await seedConversation()
    const run = await seedRun(conversationId)
    const step = await seedStep(run.id, new Date())
    const evidence = await seedEvidence(run.id, new Date())
    const [message] = await testDb
      .insert(conversationMessages)
      .values({ conversationId, senderType: 'visitor', content: 'what is the refund window?' })
      .returning()
    const [receipt] = await testDb
      .insert(assistantToolCalls)
      .values({
        conversationId,
        runId: run.id,
        toolName: 'create_ticket',
        args: { title: 'x' },
        status: 'succeeded',
      })
      .returning()
    const [regression] = await testDb
      .insert(assistantRegressionCases)
      .values({
        title: 'Refund window',
        question: 'what is the refund window?',
        expectation: 'answers',
        conversationId,
        messageId: message.id,
        runId: run.id,
      })
      .returning()

    await testDb.delete(conversations).where(eq(conversations.id, conversationId))

    expect(
      await testDb.select().from(assistantRuns).where(eq(assistantRuns.id, run.id))
    ).toHaveLength(0)
    expect(await countSteps(step.id)).toBe(0)
    expect(await countEvidence(evidence.id)).toBe(0)
    expect(
      await testDb.select().from(assistantToolCalls).where(eq(assistantToolCalls.id, receipt.id))
    ).toHaveLength(0)
    // The question is a copy of what the customer wrote, so the case goes too.
    expect(
      await testDb
        .select()
        .from(assistantRegressionCases)
        .where(eq(assistantRegressionCases.id, regression.id))
    ).toHaveLength(0)
  })
})
