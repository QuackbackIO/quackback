/**
 * Regression cases: turning one correction into a check (QUINN-PRODUCT P8).
 *
 * A teammate correcting Quinn's answer already writes the right answer down as
 * an approved snippet, which fixes the fact for the next customer who asks. It
 * does not stop the fix being undone: a wording change, a guidance edit or a
 * new connector policy can move the behaviour back, and nothing would notice.
 * A case is the other half. It keeps the question, and what a correct answer
 * has to do with it, so a release candidate can be checked against it.
 *
 * Identity is the corrected message, under a unique index, so the same
 * correction added twice is the same case. The pre-read is the fast path; the
 * index is the guarantee, and the lost race is collected by catching it, which
 * is the shape Step 7 established for the capture key.
 */
import { db, desc, eq, assistantRegressionCases } from '@/lib/server/db'
import type { AssistantRegressionCase, AssistantRegressionExpectation } from '@/lib/server/db'
import type {
  AssistantRegressionCaseId,
  AssistantRunId,
  ConversationId,
  ConversationMessageId,
  PrincipalId,
} from '@quackback/ids'
import type { Executor } from '@/lib/server/domains/principals/principal.factory'
import { ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'assistant-regression-cases' })

/** How many cases one release check will run. Bounded: each is a real turn. */
export const REGRESSION_CASE_RUN_LIMIT = 5

const TITLE_MAX = 120
const QUESTION_MAX = 2000
const NOTE_MAX = 4000

export interface AddRegressionCaseInput {
  question: string
  /** What a correct answer must do. Structural; there is no graded expected text. */
  expectation: AssistantRegressionExpectation
  expectedSourceType?: string | null
  expectedSourceId?: string | null
  correctionNote?: string | null
  title?: string | null
  conversationId?: ConversationId | null
  messageId?: ConversationMessageId | null
  runId?: AssistantRunId | null
  createdByPrincipalId?: PrincipalId | null
  origin?: 'answer_correction' | 'manual'
}

function truncate(value: string, max: number): string {
  const trimmed = value.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

/**
 * Keep a question as a case, once.
 *
 * Returns the existing case when this message already has one, so the control
 * is safe to press twice and a retried request answers with the same row.
 */
export async function addRegressionCase(
  input: AddRegressionCaseInput,
  exec: Executor = db
): Promise<AssistantRegressionCase> {
  const question = input.question.trim()
  if (!question) throw new ValidationError('VALIDATION_ERROR', 'A question is required')
  if (
    input.expectation === 'cites_source' &&
    !(input.expectedSourceType && input.expectedSourceId)
  ) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'A case that expects a citation must name the source'
    )
  }

  if (input.messageId) {
    const [existing] = await exec
      .select()
      .from(assistantRegressionCases)
      .where(eq(assistantRegressionCases.messageId, input.messageId))
    if (existing) return existing
  }

  const values: typeof assistantRegressionCases.$inferInsert = {
    title: truncate(input.title?.trim() || question, TITLE_MAX),
    question: truncate(question, QUESTION_MAX),
    expectation: input.expectation,
    expectedSourceType: input.expectedSourceType ?? null,
    expectedSourceId: input.expectedSourceId ?? null,
    correctionNote: input.correctionNote ? truncate(input.correctionNote, NOTE_MAX) : null,
    origin: input.origin ?? 'answer_correction',
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    runId: input.runId ?? null,
    createdByPrincipalId: input.createdByPrincipalId ?? null,
  }

  try {
    const [row] = await exec.insert(assistantRegressionCases).values([values]).returning()
    log.info({ case_id: row.id, expectation: row.expectation }, 'regression case recorded')
    return row
  } catch (err) {
    // The unique index on the corrected message is the guarantee; losing the
    // race means somebody else wrote the same case, which is the right answer.
    if (input.messageId) {
      const [existing] = await exec
        .select()
        .from(assistantRegressionCases)
        .where(eq(assistantRegressionCases.messageId, input.messageId))
      if (existing) return existing
    }
    throw err
  }
}

/** Every case, newest first, for the review list. */
export async function listRegressionCases(
  limit = 50,
  exec: Executor = db
): Promise<AssistantRegressionCase[]> {
  return exec
    .select()
    .from(assistantRegressionCases)
    .orderBy(desc(assistantRegressionCases.createdAt))
    .limit(Math.max(1, Math.min(limit, 200)))
}

/** The cases a release check will actually run, oldest first so the set is stable. */
export async function listEnabledRegressionCases(
  limit = REGRESSION_CASE_RUN_LIMIT,
  exec: Executor = db
): Promise<AssistantRegressionCase[]> {
  return exec
    .select()
    .from(assistantRegressionCases)
    .where(eq(assistantRegressionCases.enabled, true))
    .orderBy(assistantRegressionCases.createdAt)
    .limit(Math.max(1, Math.min(limit, REGRESSION_CASE_RUN_LIMIT)))
}

/** Turn a case on or off without deleting the record of it. */
export async function setRegressionCaseEnabled(
  id: AssistantRegressionCaseId,
  enabled: boolean,
  exec: Executor = db
): Promise<AssistantRegressionCase | null> {
  const [row] = await exec
    .update(assistantRegressionCases)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(assistantRegressionCases.id, id))
    .returning()
  return row ?? null
}

export interface RegressionCaseVerdict {
  id: string
  title: string
  passed: boolean
  reason: string
}

/**
 * Grade one sandbox turn against one case. Pure, so the rule is readable and
 * testable without a model.
 *
 * Structural only. `answers` asks for a publishable answer rather than an
 * inability or a hand-off; `cites_source` asks for that AND the recorded source
 * among its citations; `hands_off` asks for the opposite, which is what a case
 * captured from a question Quinn should never have tried looks like.
 */
export function gradeRegressionCase(
  testCase: Pick<
    AssistantRegressionCase,
    'id' | 'title' | 'expectation' | 'expectedSourceType' | 'expectedSourceId'
  >,
  turn: {
    status: string
    handoff: boolean
    citations: ReadonlyArray<{ type: string; id: string }>
  }
): RegressionCaseVerdict {
  const answered = turn.status === 'answered' && !turn.handoff
  if (testCase.expectation === 'hands_off') {
    return {
      id: testCase.id,
      title: testCase.title,
      passed: !answered,
      reason: answered ? 'answered a question it should have handed over' : 'handed over',
    }
  }
  if (!answered) {
    return {
      id: testCase.id,
      title: testCase.title,
      passed: false,
      reason: turn.handoff ? 'handed over instead of answering' : `did not answer (${turn.status})`,
    }
  }
  if (testCase.expectation === 'answers') {
    return { id: testCase.id, title: testCase.title, passed: true, reason: 'answered' }
  }
  const cited = turn.citations.some(
    (citation) =>
      citation.type === testCase.expectedSourceType && citation.id === testCase.expectedSourceId
  )
  return {
    id: testCase.id,
    title: testCase.title,
    passed: cited,
    reason: cited ? 'answered from the corrected source' : 'answered without the corrected source',
  }
}
