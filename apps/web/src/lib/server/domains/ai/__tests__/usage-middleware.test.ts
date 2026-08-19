/**
 * Tests for the chat()-native usage-logging middleware: one ai_usage_log row
 * per invocation, token totals accumulated across agent-loop iterations, and
 * error/abort outcomes recorded with zeroed-or-partial usage rather than
 * dropped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChatMiddlewareContext, ErrorInfo, UsageInfo } from '@tanstack/ai'

const logAiUsage = vi.fn().mockResolvedValue(undefined)
vi.mock('../usage-log', () => ({
  logAiUsage: (params: unknown) => logAiUsage(params),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: vi.fn() }) },
}))

import { createUsageLoggingMiddleware } from '../usage-middleware'

const ctx = (requestId = 'req-1'): ChatMiddlewareContext =>
  ({ requestId, model: 'test-model', provider: 'openai-compatible' }) as ChatMiddlewareContext

const usage = (promptTokens: number, completionTokens: number): UsageInfo =>
  ({ promptTokens, completionTokens, totalTokens: promptTokens + completionTokens }) as UsageInfo

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
}

describe('createUsageLoggingMiddleware', () => {
  beforeEach(() => {
    logAiUsage.mockClear()
  })

  it('logs one success row with usage accumulated across iterations', async () => {
    const mw = createUsageLoggingMiddleware({ pipelineStep: 'ticket_summary', model: 'fallback' })
    const c = ctx()
    mw.onStart?.(c)
    mw.onUsage?.(c, usage(100, 20))
    mw.onUsage?.(c, usage(150, 40))
    mw.onFinish?.(c, { finishReason: 'stop' } as never)
    await flush()

    expect(logAiUsage).toHaveBeenCalledTimes(1)
    expect(logAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineStep: 'ticket_summary',
        callType: 'chat_completion',
        model: 'test-model',
        inputTokens: 250,
        outputTokens: 60,
        totalTokens: 310,
        status: 'success',
      })
    )
  })

  it('logs an error row with the error message', async () => {
    const mw = createUsageLoggingMiddleware({ pipelineStep: 'extraction', model: 'm' })
    const c = ctx('req-err')
    mw.onStart?.(c)
    mw.onError?.(c, { error: new Error('boom') } as ErrorInfo)
    await flush()

    expect(logAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', error: 'boom', inputTokens: 0, totalTokens: 0 })
    )
  })

  it('logs abort as an error outcome and never double-logs', async () => {
    const mw = createUsageLoggingMiddleware({ pipelineStep: 'extraction', model: 'm' })
    const c = ctx('req-abort')
    mw.onStart?.(c)
    mw.onAbort?.(c, {} as never)
    mw.onFinish?.(c, {} as never)
    await flush()

    expect(logAiUsage).toHaveBeenCalledTimes(1)
    expect(logAiUsage).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', error: 'aborted' })
    )
  })

  it('keeps concurrent invocations separate by requestId', async () => {
    const mw = createUsageLoggingMiddleware({ pipelineStep: 'summary', model: 'm' })
    const a = ctx('req-a')
    const b = ctx('req-b')
    mw.onStart?.(a)
    mw.onStart?.(b)
    mw.onUsage?.(a, usage(10, 1))
    mw.onUsage?.(b, usage(20, 2))
    mw.onFinish?.(a, {} as never)
    mw.onFinish?.(b, {} as never)
    await flush()

    expect(logAiUsage).toHaveBeenCalledTimes(2)
    const rows = logAiUsage.mock.calls.map(([p]) => p as { inputTokens: number })
    expect(rows.map((r) => r.inputTokens).sort((x, y) => x - y)).toEqual([10, 20])
  })
})
