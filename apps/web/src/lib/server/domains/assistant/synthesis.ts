/**
 * Ask AI synthesis seam.
 *
 * Thin wrapper around TanStack AI's server core: a one-shot structured chat()
 * over pre-stuffed knowledge-base context. No tools, single iteration by
 * construction. Consumers get answer-text deltas plus a final validated
 * payload whose citations are guaranteed to be a subset of the retrieved
 * article ids. The interface is transport-agnostic so the underlying engine
 * can be swapped without touching callers.
 */

import { z } from 'zod'
import { config } from '@/lib/server/config'
import { isAiClientConfigured } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { logger } from '@/lib/server/logger'
import { runSynthesis, salvageJsonWithSchema } from './synthesis-core'
import { ASK_AI_USER_MESSAGE_GUARD } from './injection-guard'
import type { RetrievedKbArticle } from './retrieval'

const log = logger.child({ component: 'assistant-synthesis' })

export interface AskAiSource {
  articleId: string
}

/**
 * 'grounded': the answer is built from and cites retrieved articles.
 * 'no_answer': a graceful, uncited "couldn't find that" reply — never a
 * fabricated product claim, so it carries no sources.
 */
export type AskAiAnswerKind = 'grounded' | 'no_answer'

export interface AskAiAnswer {
  kind: AskAiAnswerKind
  answer: string
  sources: AskAiSource[]
}

export interface SynthesizeAnswerParams {
  query: string
  articles: RetrievedKbArticle[]
  /** Aborting this signal cancels the in-flight provider call. */
  signal?: AbortSignal
  /** Called with each new fragment of the answer text as it streams. */
  onAnswerDelta?: (delta: string) => void
}

export class AskAiNotConfiguredError extends Error {
  constructor() {
    super('Ask AI is not configured: an AI client and chat model are required')
    this.name = 'AskAiNotConfiguredError'
  }
}

/** Whether Ask AI can run: AI client plus an effective chat model. */
export function isAskAiConfigured(): boolean {
  return (
    isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) &&
    getChatModel('helpCenterAnswers') !== null
  )
}

const answerSchema = z.object({
  kind: z.enum(['grounded', 'no_answer']),
  answer: z.string(),
  sources: z.array(z.object({ articleId: z.string() })),
})

/**
 * Last-resort miss text when the model declares a miss but writes nothing, or
 * when a "grounded" answer loses all its citations (potential fabrication we
 * refuse to show). Keeps the surface from ever dead-ending on an empty reply.
 */
export const ASK_AI_MISS_FALLBACK =
  "I couldn't find a reliable answer to that in the help articles. Try rephrasing your question, browsing the articles, or contacting the team."

/**
 * System prompts for the one-shot answer: instructions first, then the
 * numbered source articles. Exported so tests can pin the injection guard
 * and citation rules.
 */
export function buildAskAiSystemPrompts(articles: RetrievedKbArticle[]): string[] {
  const instructions = [
    'You are a help-center assistant. Always reply with a helpful message; never return an empty answer.',
    'Decide between two modes and set "kind" accordingly:',
    '- "grounded": the source articles below contain the answer. Answer from them with inline [n] citations.',
    '- "no_answer": the sources do not answer the question (or there are no sources).',
    'Grounding (for a "grounded" answer):',
    "- Use only facts stated in the sources. Never use outside knowledge or guess about this product's features, settings, pricing, or steps.",
    'When you cannot answer (set "kind" to "no_answer"):',
    '- Write one or two warm sentences that acknowledge specifically what the customer asked about, then suggest rephrasing, browsing the articles, or contacting the team.',
    '- NEVER invent product features, settings paths, or step-by-step instructions that are not in the sources. Do not guess how this product works.',
    '- Leave "sources" empty.',
    'Citations (required for a "grounded" answer):',
    '- Support every claim with an inline citation marker in square brackets, like [1] or [2], placed right after the clause it supports.',
    '- Number citations in the order you first use them: the first article you cite is [1], the next distinct article is [2], and so on.',
    '- List each cited article once in "sources", in that same order, so [n] refers to the n-th entry of "sources". Every number used inline must have a matching "sources" entry, and every "sources" entry must be cited at least once.',
    '- Put only the articleId values listed below in "sources". Never invent an articleId.',
    'Style:',
    '- Reply in the same language as the question.',
    '- Be concise and factual: at most 120 words.',
    '- Plain sentences. You may use "- " bullet lists or "1. " numbered lists for steps, and **bold** for key UI labels. No headings, no tables, no HTML, and no links other than the [n] citation markers.',
    'Security:',
    `- ${ASK_AI_USER_MESSAGE_GUARD}`,
    'Respond with JSON of the shape {"kind": "grounded" | "no_answer", "answer": string, "sources": [{"articleId": string}]}, where "answer" is the prose (with inline [n] markers when grounded) and "sources" is the ordered citation list.',
  ].join('\n')

  const sources = articles
    .map(
      (a) =>
        `articleId: ${a.id}\nTitle: ${a.title}\nCategory: ${a.categoryName}\nContent:\n${a.content}`
    )
    .join('\n\n---\n\n')

  return [instructions, `Source articles:\n\n${sources}`]
}

/**
 * Produce an answer for a query from retrieved articles.
 *
 * Always resolves to a non-empty message: a grounded, cited answer when the
 * sources support one, otherwise a graceful `no_answer` miss (which may carry
 * no sources). Runs at most two attempts; a malformed stream is salvaged with
 * jsonrepair before a retry, and only a total provider failure throws (the
 * route surfaces that as a transient error, distinct from a doc miss).
 */
export async function synthesizeAnswer(params: SynthesizeAnswerParams): Promise<AskAiAnswer> {
  const model = getChatModel('helpCenterAnswers')
  if (!model || !isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl)) {
    throw new AskAiNotConfiguredError()
  }

  const retrievedIds = new Set(params.articles.map((a) => a.id))
  const articleIds = params.articles.map((a) => a.id)
  // The prompts are identical across attempts; build them once.
  const systemPrompts = buildAskAiSystemPrompts(params.articles)

  const outcome = await runSynthesis<never>({
    model,
    systemPrompts,
    messages: [{ role: 'user', content: params.query }],
    outputSchema: answerSchema,
    tools: null,
    // User-facing single-shot Ask AI: one transport re-dial on a pristine
    // RUN_ERROR (nothing streamed) is worth the small added latency to turn a
    // transient 429/5xx into an answer; a committed failure never re-dials.
    transportRetries: 1,
    deltaField: 'answer',
    salvageMode: 'strict',
    salvage: (raw) => salvageJsonWithSchema(answerSchema, raw),
    onFailure: 'throw',
    signal: params.signal,
    onTextDelta: params.onAnswerDelta,
    usageLogParams: {
      pipelineStep: 'help_center_answers',
      callType: 'chat_completion',
      model,
      metadata: { kbArticleIds: articleIds, query: params.query },
    },
    // Prefer the validated structured object for classification; if the
    // stream never produced one (final is null), this attempt is invalid.
    deriveAnswerKind: (attempt) => {
      const validated = attempt.final !== null ? validateAnswer(attempt.final, retrievedIds) : null
      return validated === null
        ? 'invalid_output'
        : validated.kind === 'grounded'
          ? 'answered'
          : 'no_answer'
    },
    onRetry: (_attempt, error) => {
      log.warn({ err: error }, 'ask ai attempt failed, retrying once')
    },
  })

  if (outcome.outcome === 'fallback') {
    // Unreachable: onFailure:'throw' always throws on total failure rather
    // than resolving to a fallback value.
    throw outcome.lastError ?? new Error('answer synthesis failed')
  }
  return validateAnswer(outcome.final, retrievedIds)
}

/**
 * Server-side guardrail: re-validate the model output shape and keep only
 * citations that reference retrieved articles (deduplicated, model order).
 *
 * A grounded answer must cite at least one retrieved article; if none survive,
 * its prose may be an ungrounded fabrication, so we discard it and fall back to
 * a safe miss. A declared miss keeps its contextual text (or the fallback when
 * the model wrote nothing), and never carries sources.
 */
function validateAnswer(object: unknown, retrievedIds: Set<string>): AskAiAnswer {
  const parsed = answerSchema.parse(object)
  const seen = new Set<string>()
  const sources = parsed.sources.filter((s) => {
    if (!retrievedIds.has(s.articleId) || seen.has(s.articleId)) return false
    seen.add(s.articleId)
    return true
  })
  if (parsed.kind === 'grounded' && sources.length > 0) {
    return { kind: 'grounded', answer: parsed.answer, sources }
  }
  const trimmed = parsed.answer.trim()
  const missText = parsed.kind === 'no_answer' && trimmed ? trimmed : ASK_AI_MISS_FALLBACK
  return { kind: 'no_answer', answer: missText, sources: [] }
}
