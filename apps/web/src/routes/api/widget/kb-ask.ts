/**
 * Ask AI endpoint: streams a synthesized, cited answer built only from
 * published help-center articles.
 *
 * Same public envelope as kb-search (feature gate + CORS *), plus the
 * helpCenterAiAnswers flag, a per-IP rate limit, and a query length cap.
 * The response is SSE with the versioned kb-ask.v1.* events; names and
 * payload shapes live in the shared contract module
 * (lib/shared/help-center/kb-ask-contract.ts), imported by this route and
 * the Ask AI client.
 *
 * Requests without a `q` act as a capability probe so public surfaces can
 * hide the affordance when AI is not configured.
 */
import { createFileRoute } from '@tanstack/react-router'
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
  KB_ASK_EVENTS,
  type KbAskErrorPayload,
  type KbAskFinalPayload,
  type KbAskSourceMeta,
  type KbAskSourcesPayload,
} from '@/lib/shared/help-center/kb-ask-contract'
import {
  enforcePerIpLimit,
  widgetCorsHeaders,
  widgetJsonError,
} from '@/lib/server/widget/public-endpoint'
import { resolveWidgetViewer } from '@/lib/server/widget/widget-viewer'
import type { Actor } from '@/lib/server/policy/types'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { logAiUsage, type AiAnswerKind } from '@/lib/server/domains/ai/usage-log'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { createSseStream, SSE_RESPONSE_HEADERS } from '@/lib/server/utils/sse'
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

export async function handleKbAsk({ request }: { request: Request }): Promise<Response> {
  const flags = await getFeatureFlags()
  if (!flags.helpCenter || !flags.helpCenterAiAnswers) {
    return widgetJsonError(404, 'NOT_FOUND', 'Knowledge base not found')
  }

  const url = new URL(request.url)
  const rawQuery = url.searchParams.get('q')

  // Capability probe: lets clients hide the Ask AI affordance when no model
  // is configured, without exposing any configuration detail.
  if (rawQuery === null) {
    return Response.json(
      { data: { enabled: isAskAiConfigured() } },
      { headers: widgetCorsHeaders() }
    )
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

  const limited = await enforcePerIpLimit(request, {
    keyPrefix: 'kbask',
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

  const sse = createSseStream()

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
        sse.send(KB_ASK_EVENTS.final, {
          kind: 'no_answer',
          answer: ASK_AI_MISS_FALLBACK,
          sources: [],
          related: related.map(toSourceMeta),
        } satisfies KbAskFinalPayload)
        return
      }

      // Stream the grounded candidates up front so the surface can show which
      // articles the answer will be built from while it streams.
      sse.send(KB_ASK_EVENTS.sources, {
        sources: articles.map(toSourceMeta),
      } satisfies KbAskSourcesPayload)

      const result = await synthesizeAnswer({
        query,
        articles,
        signal: request.signal,
        onAnswerDelta: (text) => sse.send(KB_ASK_EVENTS.delta, { text }),
      })

      if (result.kind === 'grounded' && result.sources.length > 0) {
        sse.send(KB_ASK_EVENTS.final, {
          kind: 'grounded',
          answer: result.answer,
          sources: result.sources,
        } satisfies KbAskFinalPayload)
        return
      }

      // Graceful miss: keep the model's contextual reply, and suggest related
      // near-misses as clickable next steps.
      const related = await relatedArticles(query, articles, viewer)
      sse.send(KB_ASK_EVENTS.final, {
        kind: 'no_answer',
        answer: result.answer,
        sources: [],
        related: related.map(toSourceMeta),
      } satisfies KbAskFinalPayload)
    } catch (error) {
      if (!request.signal.aborted) {
        log.error({ err: error }, 'kb ask synthesis failed')
        sse.send(KB_ASK_EVENTS.error, {
          code: 'SYNTHESIS_FAILED',
          message: 'Answer generation failed',
        } satisfies KbAskErrorPayload)
      }
    } finally {
      sse.close()
    }
  })()

  return new Response(sse.stream, {
    headers: { ...widgetCorsHeaders(), ...SSE_RESPONSE_HEADERS },
  })
}

export const Route = createFileRoute('/api/widget/kb-ask')({
  server: {
    handlers: {
      GET: handleKbAsk,
    },
  },
})
