/**
 * Ask AI endpoint: streams a synthesized, cited answer built only from
 * published help-center articles.
 *
 * Same public envelope as kb-search (feature gate + CORS *), plus the
 * helpCenterAiAnswers flag, a per-IP/session/tenant rate limit, and a
 * query length cap. The session and tenant buckets stop a single anonymous
 * session (or a Host-header switcheroo) from burning unlimited AI budget
 * even while staying under the per-IP cap.
 *
 * WIRE: TanStack AI's AG-UI protocol. The client POSTs a `RunAgentInput` (its
 * message history; the trailing user turn is the question), and the response
 * is `toServerSentEventsResponse` over one canonical RUN_STARTED/RUN_FINISHED
 * pair: a STATE_SNAPSHOT of the retrieved-article display metadata (the
 * citation-dot join, shipped before the answer streams), then the buffered
 * model chunks forwarded off synthesis's wireSink, then a terminal
 * RUN_FINISHED whose standard `result` slot carries the validated answer
 * (kind/answer/sources/related). A failure ends the stream with a coded
 * RUN_ERROR frame. Payload shapes live in the shared contract module
 * (lib/shared/help-center/kb-ask-contract.ts), imported by this route and the
 * Ask AI client.
 *
 * A GET (no answer path anymore) is a capability probe so public surfaces can
 * hide the affordance when AI is not configured.
 */
import { createFileRoute } from '@tanstack/react-router'
import { toServerSentEventsResponse, chatParamsFromRequestBody } from '@tanstack/ai'
import { getFeatureFlags } from '@/lib/server/domains/settings/settings.service'
import {
  retrieveKbArticles,
  synthesizeAnswer,
  isAskAiConfigured,
  ASK_AI_MISS_FALLBACK,
  RELATED_SIMILARITY_FLOOR,
  type RetrievedKbArticle,
} from '@/lib/server/domains/assistant'
import {
  createChunkQueue,
  createPairingTracker,
  runStartedChunk,
  runFinishedChunk,
  runErrorChunk,
  stateSnapshotChunk,
} from '@/lib/server/domains/assistant/agui'
import type {
  KbAskFinalPayload,
  KbAskSourceMeta,
  KbAskStateSnapshot,
} from '@/lib/shared/help-center/kb-ask-contract'
import {
  enforceWidgetQuota,
  widgetCorsHeaders,
  widgetJsonError,
} from '@/lib/server/widget/public-endpoint'
import { resolveWidgetViewer } from '@/lib/server/widget/widget-viewer'
import { getSettings } from '@/lib/server/functions/workspace'
import type { Actor } from '@/lib/server/policy/types'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { logAiUsage, type AiAnswerKind } from '@/lib/server/domains/ai/usage-log'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'widget-kb-ask' })

export const KB_ASK_MAX_QUERY_CHARS = 500
export const KB_ASK_RATE_LIMIT = 10
const RATE_WINDOW_SECONDS = 60

/** How many related near-miss articles to suggest alongside a no-answer. */
const KB_ASK_RELATED_TOP_K = 3

function toSourceMeta(a: RetrievedKbArticle): KbAskSourceMeta {
  return {
    articleId: a.id,
    title: a.title,
    slug: a.slug,
    categorySlug: a.categorySlug,
    categoryName: a.categoryName,
  }
}

/**
 * The question is the trailing user turn's text. History is machine-accumulated
 * by the client, so read the last user message's string content (Ask AI is
 * single-turn; earlier turns, if any, are grounding the client chose to send).
 */
function trailingUserQuestion(messages: ReadonlyArray<unknown>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as { role?: string; content?: unknown }
    if (message.role === 'user') {
      return typeof message.content === 'string' ? message.content : null
    }
  }
  return null
}

/**
 * Near-miss suggestions to offer on a no-answer: reuse the articles already
 * retrieved, or widen the net with a softer similarity floor when nothing
 * cleared the answer floor. Never throws — suggestions are best-effort.
 */
async function relatedArticles(
  query: string,
  retrieved: RetrievedKbArticle[],
  viewer: Actor
): Promise<RetrievedKbArticle[]> {
  if (retrieved.length > 0) return retrieved.slice(0, KB_ASK_RELATED_TOP_K)
  try {
    // topK already caps the row count in SQL, so no post-slice is needed.
    return await retrieveKbArticles(query, {
      audience: 'public',
      viewer,
      minScore: RELATED_SIMILARITY_FLOOR,
      topK: KB_ASK_RELATED_TOP_K,
    })
  } catch {
    return []
  }
}

/**
 * Capability probe: lets clients hide the Ask AI affordance when no model is
 * configured, without exposing any configuration detail. The answer path is
 * POST-only, so a GET only ever probes.
 */
export async function handleKbAskProbe({
  request: _request,
}: {
  request: Request
}): Promise<Response> {
  const flags = await getFeatureFlags()
  if (!flags.helpCenter || !flags.helpCenterAiAnswers) {
    return widgetJsonError(404, 'NOT_FOUND', 'Knowledge base not found')
  }
  return Response.json({ data: { enabled: isAskAiConfigured() } }, { headers: widgetCorsHeaders() })
}

export async function handleKbAsk({ request }: { request: Request }): Promise<Response> {
  const flags = await getFeatureFlags()
  if (!flags.helpCenter || !flags.helpCenterAiAnswers) {
    return widgetJsonError(404, 'NOT_FOUND', 'Knowledge base not found')
  }

  // Parse the AG-UI RunAgentInput; the question is the trailing user turn.
  let messages: ReadonlyArray<unknown>
  let threadId: string
  let runId: string
  try {
    const params = await chatParamsFromRequestBody(await request.json())
    messages = params.messages
    threadId = params.threadId
    runId = params.runId
  } catch {
    return widgetJsonError(400, 'INVALID_REQUEST', 'Invalid request body')
  }

  const rawQuery = trailingUserQuestion(messages)
  if (rawQuery === null) {
    return widgetJsonError(400, 'INVALID_QUERY', 'A question is required')
  }
  const query = rawQuery.trim()
  if (!query) {
    return widgetJsonError(400, 'INVALID_QUERY', 'Query must not be empty')
  }
  if (query.length > KB_ASK_MAX_QUERY_CHARS) {
    return widgetJsonError(
      413,
      'QUERY_TOO_LONG',
      `Query exceeds ${KB_ASK_MAX_QUERY_CHARS} characters`
    )
  }

  // Configuration is a sync check: refuse before spending a Redis round-trip
  // on rate limiting requests that could never be answered.
  if (!isAskAiConfigured()) {
    return widgetJsonError(503, 'AI_NOT_CONFIGURED', 'AI answers are not configured')
  }

  // Tenant bucket is keyed on the resolved workspace, not caller-supplied
  // headers, so it can't be evaded the way a Host-header key could.
  const settings = await getSettings()
  if (!settings) return widgetJsonError(503, 'WORKSPACE_UNAVAILABLE', 'Workspace unavailable')

  const limited = await enforceWidgetQuota(request, {
    keyPrefix: 'kbask',
    tenantId: settings.id,
    limit: KB_ASK_RATE_LIMIT,
    windowSeconds: RATE_WINDOW_SECONDS,
    message: 'Too many questions, slow down',
  })
  if (limited) return limited

  try {
    await enforceAiTokenBudget()
  } catch (error) {
    if (error instanceof TierLimitError) {
      return widgetJsonError(error.statusCode, error.code, error.message)
    }
    throw error
  }

  const retrievalStartedAt = Date.now()
  // Identified widget users may answer from segment-gated categories they
  // belong to; unidentified callers resolve anonymous and see only ungated
  // articles (fail closed).
  const viewer = await resolveWidgetViewer()
  let articles
  try {
    articles = await retrieveKbArticles(query, { audience: 'public', viewer })
  } catch (error) {
    log.error({ err: error }, 'kb ask retrieval failed')
    return widgetJsonError(500, 'SERVER_ERROR', 'Answer lookup failed')
  }

  // One canonical RUN_STARTED ... RUN_FINISHED (or RUN_ERROR) pair. The pairing
  // tracker closes any TEXT_MESSAGE triad a committed-but-failed attempt left
  // open before the terminal frame; wireSink forwards synthesis's buffered
  // model chunks straight into the queue the SSE serializer drains.
  const wire = { threadId, runId }
  const queue = createChunkQueue()
  const pairing = createPairingTracker((chunk) => queue.push(chunk))
  const wireSink = (chunk: Parameters<typeof pairing.observe>[0]) => {
    pairing.observe(chunk)
    queue.push(chunk)
  }

  queue.push(runStartedChunk(wire))
  void (async () => {
    try {
      // Nothing cleared the answer floor: skip the model entirely. On empty
      // context it can only answer from training, and those ungrounded deltas
      // would stream to the client before the final no_answer overrides them.
      // Emit a graceful miss with related near-misses instead.
      if (articles.length === 0) {
        const related = await relatedArticles(query, articles, viewer)
        void logAiUsage({
          pipelineStep: 'help_center_answers',
          callType: 'chat_completion',
          model: getChatModel('helpCenterAnswers') ?? 'none',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs: Date.now() - retrievalStartedAt,
          status: 'success',
          metadata: { answerKind: 'no_sources' satisfies AiAnswerKind, query },
        }).catch((err) => log.warn({ err }, 'failed to log ai usage for kb-ask no_sources'))
        queue.push(
          runFinishedChunk(wire, {
            kind: 'no_answer',
            answer: ASK_AI_MISS_FALLBACK,
            sources: [],
            related: related.map(toSourceMeta),
          } satisfies KbAskFinalPayload)
        )
        queue.end()
        return
      }

      // Ship the grounded candidates up front so the surface can show which
      // articles the answer will be built from while it streams.
      queue.push(
        stateSnapshotChunk({
          sources: articles.map(toSourceMeta),
        } satisfies KbAskStateSnapshot)
      )

      const result = await synthesizeAnswer({
        query,
        articles,
        signal: request.signal,
        wireSink,
      })
      pairing.closeOpen()

      if (result.kind === 'grounded' && result.sources.length > 0) {
        queue.push(
          runFinishedChunk(wire, {
            kind: 'grounded',
            answer: result.answer,
            sources: result.sources,
          } satisfies KbAskFinalPayload)
        )
        queue.end()
        return
      }

      // Graceful miss: keep the model's contextual reply, and suggest related
      // near-misses as clickable next steps.
      const related = await relatedArticles(query, articles, viewer)
      queue.push(
        runFinishedChunk(wire, {
          kind: 'no_answer',
          answer: result.answer,
          sources: [],
          related: related.map(toSourceMeta),
        } satisfies KbAskFinalPayload)
      )
      queue.end()
    } catch (error) {
      pairing.closeOpen()
      if (!request.signal.aborted) {
        log.error({ err: error }, 'kb ask synthesis failed')
        queue.push(runErrorChunk(wire, 'SYNTHESIS_FAILED', 'Answer generation failed'))
      }
      queue.end()
    }
  })()

  return toServerSentEventsResponse(queue.stream(), { headers: widgetCorsHeaders() })
}

export const Route = createFileRoute('/api/widget/kb-ask')({
  server: {
    handlers: {
      GET: handleKbAskProbe,
      POST: handleKbAsk,
    },
  },
})
