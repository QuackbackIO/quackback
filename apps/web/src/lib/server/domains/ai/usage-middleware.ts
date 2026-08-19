/**
 * ai_usage_log accounting hung off TanStack AI's `ChatMiddleware` lifecycle —
 * the `chat()`-native counterpart of `withUsageLogging` for callers that have
 * moved off the raw OpenAI SDK. One log row per `chat()` invocation, with
 * token totals accumulated across every agent-loop iteration the invocation
 * makes (onUsage fires once per iteration).
 *
 * Keyed by ctx.requestId, mirroring tracing-middleware.ts, so a single
 * middleware instance stays correct across the sequential chat() calls a
 * retrying caller can make.
 */
import type { ChatMiddleware, ChatMiddlewareContext, ErrorInfo, UsageInfo } from '@tanstack/ai'
import { logAiUsage, type LogAiUsageParams } from './usage-log'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ai-usage-middleware' })

export type UsageMiddlewareParams = Omit<
  LogAiUsageParams,
  | 'callType'
  | 'inputTokens'
  | 'outputTokens'
  | 'totalTokens'
  | 'durationMs'
  | 'retryCount'
  | 'status'
  | 'error'
>

interface CallState {
  startedAt: number
  usage: { input: number; output: number; total: number }
}

export function createUsageLoggingMiddleware(params: UsageMiddlewareParams): ChatMiddleware {
  const calls = new Map<string, CallState>()

  const finalize = (
    ctx: ChatMiddlewareContext,
    outcome: Pick<LogAiUsageParams, 'status' | 'error'>
  ): void => {
    const state = calls.get(ctx.requestId)
    if (!state) return
    calls.delete(ctx.requestId)
    void logAiUsage({
      ...params,
      callType: 'chat_completion',
      model: ctx.model ?? params.model,
      inputTokens: state.usage.input,
      outputTokens: state.usage.output,
      totalTokens: state.usage.total,
      durationMs: Date.now() - state.startedAt,
      ...outcome,
    }).catch((err) => {
      log.warn({ err }, 'failed to log ai usage')
    })
  }

  return {
    name: 'ai-usage-logging',

    onStart(ctx: ChatMiddlewareContext) {
      calls.set(ctx.requestId, {
        startedAt: Date.now(),
        usage: { input: 0, output: 0, total: 0 },
      })
    },

    onUsage(ctx: ChatMiddlewareContext, usage: UsageInfo) {
      const state = calls.get(ctx.requestId)
      if (!state) return
      if (typeof usage.promptTokens === 'number') state.usage.input += usage.promptTokens
      if (typeof usage.completionTokens === 'number') state.usage.output += usage.completionTokens
      if (typeof usage.totalTokens === 'number') state.usage.total += usage.totalTokens
    },

    onFinish(ctx: ChatMiddlewareContext) {
      finalize(ctx, { status: 'success' })
    },

    onError(ctx: ChatMiddlewareContext, info: ErrorInfo) {
      finalize(ctx, {
        status: 'error',
        error: info.error instanceof Error ? info.error.message : String(info.error),
      })
    },

    onAbort(ctx: ChatMiddlewareContext) {
      finalize(ctx, { status: 'error', error: 'aborted' })
    },
  }
}
