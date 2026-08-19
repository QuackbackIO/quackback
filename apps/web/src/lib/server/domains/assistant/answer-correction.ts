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
  ConversationId,
  PrincipalId,
  TicketId,
} from '@quackback/ids'
import { ValidationError } from '@/lib/shared/errors'
import { createSnippet, type SnippetInput } from './snippet.service'

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
  messageId?: string
  /** Snippet audience override; defaults to 'team' (snippet.service default). */
  audience?: SnippetInput['audience']
  principalId?: PrincipalId
}

export interface AnswerCorrectionResult {
  eventId: AssistantEventId
  snippet: { id: AssistantSnippetId; title: string; content: string }
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

  return {
    eventId: event!.id,
    snippet: { id: snippet.id, title: snippet.title, content: snippet.content },
  }
}
