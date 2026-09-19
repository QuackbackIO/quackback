/**
 * The improvement loop's own half (QUINN-PRODUCT Step 11, P8).
 *
 * A correction already writes the right answer down. These cases prove the
 * second offer: the same correction kept as a case, once, bound to the snippet
 * it created, and graded structurally so a failure can say why.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import type { ConversationId, ConversationMessageId, PrincipalId } from '@quackback/ids'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import {
  assistantRegressionCases,
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
  addRegressionCase,
  gradeRegressionCase,
  listEnabledRegressionCases,
  setRegressionCaseEnabled,
} from '../regression-cases.service'
import { recordAnswerCorrection } from '../answer-correction'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantRegressionCases.id }).from(assistantRegressionCases).limit(0)
  },
})

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

async function seedMessage(conversationId: ConversationId): Promise<ConversationMessageId> {
  const [row] = await testDb
    .insert(conversationMessages)
    .values({ conversationId, senderType: 'assistant', content: 'the wrong answer' })
    .returning()
  return row.id
}

describe('gradeRegressionCase', () => {
  const base = { id: 'case_1', title: 'Refunds' }

  it('passes an answer when the case only asks for one', () => {
    const verdict = gradeRegressionCase(
      { ...base, expectation: 'answers', expectedSourceType: null, expectedSourceId: null },
      { status: 'answered', handoff: false, citations: [] }
    )
    expect(verdict.passed).toBe(true)
  })

  it('fails a hand-off when the case asks for an answer', () => {
    const verdict = gradeRegressionCase(
      { ...base, expectation: 'answers', expectedSourceType: null, expectedSourceId: null },
      { status: 'answered', handoff: true, citations: [] }
    )
    expect(verdict.passed).toBe(false)
    expect(verdict.reason).toContain('handed over')
  })

  it('fails an answer that does not come from the corrected source', () => {
    const testCase = {
      ...base,
      expectation: 'cites_source' as const,
      expectedSourceType: 'snippet',
      expectedSourceId: 'assistant_snippet_1',
    }
    expect(
      gradeRegressionCase(testCase, {
        status: 'answered',
        handoff: false,
        citations: [{ type: 'article', id: 'article_9' }],
      }).passed
    ).toBe(false)
    expect(
      gradeRegressionCase(testCase, {
        status: 'answered',
        handoff: false,
        citations: [{ type: 'snippet', id: 'assistant_snippet_1' }],
      }).passed
    ).toBe(true)
  })

  it('passes a hands-off case exactly when the candidate declines', () => {
    const testCase = {
      ...base,
      expectation: 'hands_off' as const,
      expectedSourceType: null,
      expectedSourceId: null,
    }
    expect(
      gradeRegressionCase(testCase, { status: 'answered', handoff: true, citations: [] }).passed
    ).toBe(true)
    expect(
      gradeRegressionCase(testCase, { status: 'answered', handoff: false, citations: [] }).passed
    ).toBe(false)
  })
})

describe.skipIf(!fixture.available)('addRegressionCase', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)

  it('is the same case however many times the same correction is added', async () => {
    const conversationId = await seedConversation()
    const messageId = await seedMessage(conversationId)
    const first = await addRegressionCase({
      question: 'what is the refund window?',
      expectation: 'answers',
      conversationId,
      messageId,
    })
    const second = await addRegressionCase({
      question: 'what is the refund window?',
      expectation: 'answers',
      conversationId,
      messageId,
    })
    expect(second.id).toBe(first.id)
    const rows = await testDb
      .select()
      .from(assistantRegressionCases)
      .where(eq(assistantRegressionCases.conversationId, conversationId))
    expect(rows).toHaveLength(1)
  })

  it('refuses a citation expectation with no source named', async () => {
    await expect(
      addRegressionCase({ question: 'anything', expectation: 'cites_source' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('leaves a disabled case out of the set a check would run', async () => {
    const conversationId = await seedConversation()
    const testCase = await addRegressionCase({
      question: 'what is the refund window?',
      expectation: 'answers',
      conversationId,
    })
    expect((await listEnabledRegressionCases()).map((row) => row.id)).toContain(testCase.id)
    await setRegressionCaseEnabled(testCase.id, false)
    expect((await listEnabledRegressionCases()).map((row) => row.id)).not.toContain(testCase.id)
  })
})

describe.skipIf(!fixture.available)('recordAnswerCorrection', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  // close() is called once, from the last describe in this file.
  afterAll(fixture.close)

  it('keeps the correction as a case bound to the snippet it just wrote', async () => {
    const conversationId = await seedConversation()
    const messageId = await seedMessage(conversationId)
    const result = await recordAnswerCorrection({
      question: 'what is the refund window?',
      idealAnswer: 'Thirty days from delivery.',
      conversationId,
      messageId,
      addRegressionCase: true,
    })

    expect(result.regressionCaseId).not.toBeNull()
    const [row] = await testDb
      .select()
      .from(assistantRegressionCases)
      .where(eq(assistantRegressionCases.id, result.regressionCaseId as never))
    // The corrected fact is now a snippet, so the case asks for an answer that
    // comes FROM it rather than one that merely sounds right.
    expect(row.expectation).toBe('cites_source')
    expect(row.expectedSourceType).toBe('snippet')
    expect(row.expectedSourceId).toBe(result.snippet.id)
    expect(row.correctionNote).toBe('Thirty days from delivery.')
  })

  it('records no case unless one was asked for', async () => {
    const conversationId = await seedConversation()
    const result = await recordAnswerCorrection({
      question: 'what is the refund window?',
      idealAnswer: 'Thirty days from delivery.',
      conversationId,
    })
    expect(result.regressionCaseId).toBeNull()
    const rows = await testDb
      .select()
      .from(assistantRegressionCases)
      .where(eq(assistantRegressionCases.conversationId, conversationId))
    expect(rows).toHaveLength(0)
  })
})
