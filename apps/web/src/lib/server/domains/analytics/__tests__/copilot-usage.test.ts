/**
 * Real-DB coverage for the Copilot usage report: questions/transforms/
 * summaries counted off ai_usage_log (split by surface and transform kind),
 * the insert/feedback outcomes off assistant_events (per-kind insert counts,
 * the destination reply/note split, the rating split, reasons on down-votes,
 * unknown-type exclusion),
 * the actions funnel off assistant_pending_actions (including the
 * approved-then-executed/failed fold-in and the expired bucket), the
 * per-teammate cap + display-name join, and date-window exclusion. Runs
 * inside the db-test-fixture rollback transaction. Mirrors quinn-tools.test.ts
 * and guidance-stats.test.ts's real-DB house pattern.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId, PrincipalId } from '@quackback/ids'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  aiUsageLog,
  assistantEvents,
  assistantPendingActions,
  conversations,
  principal,
} from '@/lib/server/db'
import {
  getCopilotUsageMetrics,
  summarizeCopilotUsage,
  type CopilotTeammateQuestionCount,
} from '../copilot-usage'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: aiUsageLog.id }).from(aiUsageLog).limit(0)
    await db.select({ id: assistantPendingActions.id }).from(assistantPendingActions).limit(0)
    await db.select({ id: assistantEvents.id }).from(assistantEvents).limit(0)
  },
})

const FROM = new Date('2026-06-01T00:00:00Z')
const TO = new Date('2026-07-01T00:00:00Z')
const IN_RANGE = new Date('2026-06-15T00:00:00Z')
const BEFORE_RANGE = new Date('2026-05-01T00:00:00Z')

async function seedUsageLog(
  pipelineStep: string,
  metadata: Record<string, unknown> | null,
  createdAt: Date = IN_RANGE
) {
  await testDb.insert(aiUsageLog).values({
    pipelineStep,
    callType: 'chat_completion',
    model: 'test-model',
    inputTokens: 1,
    totalTokens: 1,
    durationMs: 1,
    status: 'success',
    metadata,
    createdAt,
  })
}

async function seedPrincipal(displayName: string): Promise<PrincipalId> {
  const [row] = await testDb
    .insert(principal)
    .values({ role: 'member', type: 'user', displayName, createdAt: new Date() })
    .returning()
  return row.id
}

async function seedConversation(): Promise<ConversationId> {
  const [visitor] = await testDb
    .insert(principal)
    .values({ role: 'user', type: 'anonymous', createdAt: new Date() })
    .returning()
  const [conversation] = await testDb
    .insert(conversations)
    .values({ visitorPrincipalId: visitor.id, channel: 'messenger' })
    .returning()
  return conversation.id
}

async function seedPendingAction(
  conversationId: ConversationId,
  status: 'proposed' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed',
  proposedAt: Date = IN_RANGE
) {
  await testDb.insert(assistantPendingActions).values({
    conversationId,
    toolName: 'end_conversation',
    args: {},
    summary: 'Close this conversation.',
    status,
    proposedAt,
    expiresAt: new Date(proposedAt.getTime() + 60 * 60 * 1000),
  })
}

async function seedAssistantEvent(
  eventType: string,
  metadata: Record<string, unknown> = {},
  createdAt: Date = IN_RANGE
) {
  await testDb.insert(assistantEvents).values({ eventType, metadata, createdAt })
}

describe('summarizeCopilotUsage (pure)', () => {
  const emptyBucket = { total: 0, approved: 0, rejected: 0, expired: 0 }
  const emptyEvents = {
    answersInserted: 0,
    transformsInserted: 0,
    summariesInserted: 0,
    insertedReplies: 0,
    insertedNotes: 0,
    feedbackUp: 0,
    feedbackDown: 0,
    feedbackDownWithReason: 0,
  }

  it('sums totalTransforms from the per-kind breakdown', () => {
    const summary = summarizeCopilotUsage(
      5,
      [
        { transform: 'my_tone', count: 2 },
        { transform: 'more_friendly', count: 3 },
      ],
      1,
      emptyBucket,
      emptyEvents,
      []
    )
    expect(summary.totalTransforms).toBe(5)
  })

  it('is null (never NaN) approvalRate when nothing was proposed', () => {
    const summary = summarizeCopilotUsage(0, [], 0, emptyBucket, emptyEvents, [])
    expect(summary.approvalRate).toBeNull()
  })

  it('computes approvalRate as approved / proposed, 0-100', () => {
    const summary = summarizeCopilotUsage(
      0,
      [],
      0,
      { total: 4, approved: 3, rejected: 1, expired: 0 },
      emptyEvents,
      []
    )
    expect(summary.approvalRate).toBe(75)
  })

  it('passes the action bucket and teammate list through untouched', () => {
    const teammates: CopilotTeammateQuestionCount[] = [
      { principalId: 'principal_1' as PrincipalId, displayName: 'Ada', questions: 9 },
    ]
    const summary = summarizeCopilotUsage(
      0,
      [],
      0,
      { total: 2, approved: 1, rejected: 0, expired: 1 },
      emptyEvents,
      teammates
    )
    expect(summary.actionsProposed).toBe(2)
    expect(summary.actionsApproved).toBe(1)
    expect(summary.actionsExpired).toBe(1)
    expect(summary.perTeammate).toEqual(teammates)
  })

  it('passes the per-kind insert counts and destination split through untouched', () => {
    const summary = summarizeCopilotUsage(
      10,
      [],
      0,
      emptyBucket,
      {
        ...emptyEvents,
        answersInserted: 3,
        transformsInserted: 2,
        summariesInserted: 1,
        insertedReplies: 4,
        insertedNotes: 2,
      },
      []
    )
    expect(summary.answersInserted).toBe(3)
    expect(summary.transformsInserted).toBe(2)
    expect(summary.summariesInserted).toBe(1)
    expect(summary.insertedReplies).toBe(4)
    expect(summary.insertedNotes).toBe(2)
  })

  it('computes insertRate as all inserted events / totalQuestions, 0-100', () => {
    const summary = summarizeCopilotUsage(
      8,
      [],
      0,
      emptyBucket,
      { ...emptyEvents, answersInserted: 1, transformsInserted: 1 },
      []
    )
    expect(summary.insertRate).toBe(25)
  })

  it('is null (never NaN) insertRate when nothing was asked', () => {
    const summary = summarizeCopilotUsage(
      0,
      [],
      0,
      emptyBucket,
      { ...emptyEvents, answersInserted: 2 },
      []
    )
    expect(summary.insertRate).toBeNull()
  })

  it('passes the feedback split through untouched', () => {
    const summary = summarizeCopilotUsage(
      0,
      [],
      0,
      emptyBucket,
      { ...emptyEvents, feedbackUp: 4, feedbackDown: 2, feedbackDownWithReason: 1 },
      []
    )
    expect(summary.feedbackUp).toBe(4)
    expect(summary.feedbackDown).toBe(2)
    expect(summary.feedbackDownWithReason).toBe(1)
  })
})

describe.skipIf(!fixture.available)('getCopilotUsageMetrics (real DB)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('totalQuestions', () => {
    it('counts assistant-step rows with surface copilot', async () => {
      await seedUsageLog('assistant', { surface: 'copilot' })
      await seedUsageLog('assistant', { surface: 'copilot' })

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.totalQuestions).toBe(2)
    })

    it('excludes assistant-step rows from other surfaces (widget, email)', async () => {
      await seedUsageLog('assistant', { surface: 'widget' })
      await seedUsageLog('assistant', { surface: 'email' })
      await seedUsageLog('assistant', null)

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.totalQuestions).toBe(0)
    })

    it('excludes rows outside the date range', async () => {
      await seedUsageLog('assistant', { surface: 'copilot' }, BEFORE_RANGE)

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.totalQuestions).toBe(0)
    })
  })

  describe('transforms', () => {
    it('splits totalTransforms by metadata.transform kind', async () => {
      await seedUsageLog('copilot_transform', { transform: 'my_tone' })
      await seedUsageLog('copilot_transform', { transform: 'my_tone' })
      await seedUsageLog('copilot_transform', { transform: 'more_friendly' })

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.totalTransforms).toBe(3)
      expect(metrics.transformsByKind).toEqual(
        expect.arrayContaining([
          { transform: 'my_tone', count: 2 },
          { transform: 'more_friendly', count: 1 },
        ])
      )
    })

    it('excludes transform rows outside the date range', async () => {
      await seedUsageLog('copilot_transform', { transform: 'my_tone' }, BEFORE_RANGE)

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.totalTransforms).toBe(0)
      expect(metrics.transformsByKind).toEqual([])
    })
  })

  describe('totalSummaries', () => {
    it('counts copilot_summary rows in range', async () => {
      await seedUsageLog('copilot_summary', { conversationId: 'conversation_1' })

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.totalSummaries).toBe(1)
    })

    it('excludes copilot_summary rows outside the date range', async () => {
      await seedUsageLog('copilot_summary', {}, BEFORE_RANGE)

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.totalSummaries).toBe(0)
    })
  })

  describe('actions funnel', () => {
    it('buckets proposed/approved/rejected/expired and computes the approval rate', async () => {
      const conversationId = await seedConversation()
      await seedPendingAction(conversationId, 'approved')
      await seedPendingAction(conversationId, 'rejected')
      await seedPendingAction(conversationId, 'expired')
      await seedPendingAction(conversationId, 'proposed')

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.actionsProposed).toBe(4)
      expect(metrics.actionsApproved).toBe(1)
      expect(metrics.actionsRejected).toBe(1)
      expect(metrics.actionsExpired).toBe(1)
      expect(metrics.approvalRate).toBe(25) // 1 of 4
    })

    it('counts an approved action that later executed as approved, not a separate bucket', async () => {
      const conversationId = await seedConversation()
      await seedPendingAction(conversationId, 'executed')
      await seedPendingAction(conversationId, 'failed')

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.actionsProposed).toBe(2)
      expect(metrics.actionsApproved).toBe(2)
      expect(metrics.approvalRate).toBe(100)
    })

    it('excludes pending actions proposed outside the date range', async () => {
      const conversationId = await seedConversation()
      await seedPendingAction(conversationId, 'approved', BEFORE_RANGE)

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.actionsProposed).toBe(0)
      expect(metrics.approvalRate).toBeNull()
    })
  })

  describe('outcomes (assistant_events)', () => {
    it('counts inserted events per kind and splits reply/note by metadata.destination', async () => {
      await seedUsageLog('assistant', { surface: 'copilot' })
      await seedUsageLog('assistant', { surface: 'copilot' })
      await seedAssistantEvent('answer_inserted', {
        destination: 'reply',
        answerType: 'draft_reply',
      })
      await seedAssistantEvent('answer_inserted', { destination: 'note' })
      await seedAssistantEvent('transform_inserted', { destination: 'reply' })
      await seedAssistantEvent('summary_inserted', { destination: 'note' })

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.answersInserted).toBe(2)
      expect(metrics.transformsInserted).toBe(1)
      expect(metrics.summariesInserted).toBe(1)
      expect(metrics.insertedReplies).toBe(2)
      expect(metrics.insertedNotes).toBe(2)
      expect(metrics.insertRate).toBe(200) // 4 inserts over 2 questions (trend-level, can exceed 100)
    })

    it('splits feedback by rating and counts down-votes carrying a reason', async () => {
      await seedAssistantEvent('feedback', { rating: 'up' })
      await seedAssistantEvent('feedback', { rating: 'down' })
      await seedAssistantEvent('feedback', { rating: 'down', reason: 'Wrong article cited' })

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.feedbackUp).toBe(1)
      expect(metrics.feedbackDown).toBe(2)
      expect(metrics.feedbackDownWithReason).toBe(1)
    })

    it('ignores unknown event types and rows outside the date range', async () => {
      await seedAssistantEvent('answer_copied')
      // A legacy kind that left the vocabulary: not in COPILOT_EVENT_TYPES,
      // so the derived query never counts it.
      await seedAssistantEvent('note_inserted', { destination: 'note' })
      await seedAssistantEvent('answer_inserted', { destination: 'reply' }, BEFORE_RANGE)
      await seedAssistantEvent('feedback', { rating: 'up' }, BEFORE_RANGE)

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.answersInserted).toBe(0)
      expect(metrics.insertedNotes).toBe(0)
      expect(metrics.feedbackUp).toBe(0)
      expect(metrics.insertRate).toBeNull()
    })
  })

  describe('perTeammate', () => {
    it('ranks teammates by question volume, most first, joined to their display name', async () => {
      const alice = await seedPrincipal('Alice')
      const bob = await seedPrincipal('Bob')
      await seedUsageLog('assistant', { surface: 'copilot', principalId: alice })
      await seedUsageLog('assistant', { surface: 'copilot', principalId: alice })
      await seedUsageLog('assistant', { surface: 'copilot', principalId: bob })

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.perTeammate[0]).toEqual({
        principalId: alice,
        displayName: 'Alice',
        questions: 2,
      })
      expect(metrics.perTeammate[1]).toEqual({
        principalId: bob,
        displayName: 'Bob',
        questions: 1,
      })
    })

    it('excludes copilot turns with no principalId in metadata (pre-attribution rows)', async () => {
      await seedUsageLog('assistant', { surface: 'copilot' })

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.perTeammate).toEqual([])
    })

    it('caps the leaderboard at 10 teammates', async () => {
      for (let i = 0; i < 12; i++) {
        const teammate = await seedPrincipal(`Teammate ${i}`)
        await seedUsageLog('assistant', { surface: 'copilot', principalId: teammate })
      }

      const metrics = await getCopilotUsageMetrics(FROM, TO)
      expect(metrics.perTeammate).toHaveLength(10)
    })
  })
})
