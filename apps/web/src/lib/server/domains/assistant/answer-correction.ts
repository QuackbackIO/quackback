/**
 * Answer-correction loop: a teammate marks a Quinn answer unhelpful and
 * attaches the ideal answer. The correction rides the existing pipelines
 * rather than a new store:
 *   - the outcome signal is one append-only `assistant_events` row
 *     (`event_type = 'answer_correction'`, rating 'down') — open-text event
 *     types mean the reporting scans that don't know this kind simply don't
 *     count it (see assistant-events.ts);
 *   - the ideal answer is persisted as a snippet (`snippet.service.ts`), so it
 *     is embedded on write and surfaces through `snippets-retrieval.ts` the
 *     next time a similar question is asked.
 */
import { db, assistantEvents } from '@/lib/server/db'
import type {
  AssistantSnippetId,
  AssistantEventId,
  AssistantRunId,
  ConversationId,
  ConversationMessageId,
  PrincipalId,
  TicketId,
} from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { logger } from '@/lib/server/logger'
import { createSnippet, type SnippetInput } from './snippet.service'
import { addRegressionCase } from './regression-cases.service'

const log = logger.child({ component: 'answer-correction' })

/** Snippet titles cap at 120 chars (snippet.service.ts); an over-long
 *  question is truncated with an ellipsis rather than rejected — the
 *  correction's value is the ideal answer, not the verbatim question. */
const QUESTION_TITLE_MAX_LENGTH = 120

export interface AnswerCorrectionInput {
  /** The question Quinn answered badly — becomes the snippet title. */
  question: string
  /** The answer Quinn should have given — becomes the snippet content. */
  idealAnswer: string
  /** Why the original answer was unhelpful, stored on the event only. */
  reason?: string
  conversationId?: ConversationId
  ticketId?: TicketId
  /** The message id of the Quinn answer being corrected, when known. */
  messageId?: ConversationMessageId
  /** Snippet audience override; defaults to 'team' (snippet.service default). */
  audience?: SnippetInput['audience']
  principalId?: PrincipalId
  /**
   * Also keep this question as a regression case (QUINN-PRODUCT P8).
   *
   * The specification's own wording: a correction continues to create an
   * approved snippet, and separately OFFERS to turn it into a case. Off unless
   * a person asked for it, because a case is run against every future release
   * candidate and a workspace should choose what it is held to.
   */
  addRegressionCase?: boolean
  /** The durable run that produced the answer being corrected, when known. */
  runId?: AssistantRunId
}

export interface AnswerCorrectionResult {
  eventId: AssistantEventId
  snippet: { id: AssistantSnippetId; title: string; content: string }
  /** The case this correction was also kept as, when one was asked for. */
  regressionCaseId: string | null
}

function truncateTitle(question: string): string {
  if (question.length <= QUESTION_TITLE_MAX_LENGTH) return question
  return `${question.slice(0, QUESTION_TITLE_MAX_LENGTH - 1)}…`
}

export async function recordAnswerCorrection(
  input: AnswerCorrectionInput
): Promise<AnswerCorrectionResult> {
  const question = input.question.trim()
  const idealAnswer = input.idealAnswer.trim()
  if (!question) throw new ValidationError('VALIDATION_ERROR', 'Question is required')
  if (!idealAnswer) throw new ValidationError('VALIDATION_ERROR', 'Ideal answer is required')

  const snippet = await createSnippet({
    title: truncateTitle(question),
    content: idealAnswer,
    ...(input.audience !== undefined && { audience: input.audience }),
    createdById: input.principalId,
  })

  const [event] = await db
    .insert(assistantEvents)
    .values({
      eventType: 'answer_correction',
      principalId: input.principalId ?? null,
      conversationId: input.conversationId ?? null,
      ticketId: input.ticketId ?? null,
      metadata: {
        rating: 'down',
        snippetId: snippet.id,
        ...(input.reason && { reason: input.reason }),
        ...(input.messageId && { messageId: input.messageId }),
      },
    })
    .returning({ id: assistantEvents.id })

  // The case is the improvement loop's other half and must not be able to lose
  // the correction: the snippet and the event are already committed, so a case
  // that cannot be written is logged and reported as absent rather than thrown.
  let regressionCaseId: string | null = null
  if (input.addRegressionCase) {
    try {
      const testCase = await addRegressionCase({
        question,
        // The corrected fact now lives in a snippet, so the honest expectation
        // is that a future candidate answers FROM it rather than merely says
        // something. That is the thing a wording or guidance change can undo.
        expectation: 'cites_source',
        expectedSourceType: 'snippet',
        expectedSourceId: snippet.id,
        correctionNote: idealAnswer,
        title: snippet.title,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        runId: input.runId ?? null,
        createdByPrincipalId: input.principalId ?? null,
      })
      regressionCaseId = testCase.id
    } catch (err) {
      log.warn({ err }, 'answer correction recorded but its regression case was not')
    }
  }

  return {
    eventId: event!.id,
    snippet: { id: snippet.id, title: snippet.title, content: snippet.content },
    regressionCaseId,
  }
}
