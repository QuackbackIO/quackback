/**
 * Tests for the assistant OTel tracing middleware. Uses a fake in-process
 * tracer (no SDK dependency) to assert span structure and — critically — that
 * no tool argument, tool result, or customer text ever lands on a span.
 */
import { describe, it, expect } from 'vitest'
import type { Span, SpanStatus, Tracer } from '@opentelemetry/api'
import type {
  AfterToolCallInfo,
  ChatMiddlewareContext,
  ErrorInfo,
  FinishInfo,
  ToolCallHookContext,
  UsageInfo,
} from '@tanstack/ai'
import { createAssistantTracingMiddleware } from '../tracing-middleware'

interface RecordedSpan {
  name: string
  attributes: Record<string, unknown>
  status?: SpanStatus
  ended: boolean
  exceptions: unknown[]
}

/** A minimal recording Tracer/Span pair — enough for the middleware's surface. */
function makeTestTracer() {
  const spans: RecordedSpan[] = []
  const tracer = {
    startSpan(name: string, options?: { attributes?: Record<string, unknown> }): Span {
      const rec: RecordedSpan = {
        name,
        attributes: { ...(options?.attributes ?? {}) },
        ended: false,
        exceptions: [],
      }
      spans.push(rec)
      const span = {
        setAttribute(key: string, value: unknown) {
          rec.attributes[key] = value
          return span
        },
        setAttributes(attrs: Record<string, unknown>) {
          Object.assign(rec.attributes, attrs)
          return span
        },
        setStatus(status: SpanStatus) {
          rec.status = status
          return span
        },
        recordException(err: unknown) {
          rec.exceptions.push(err)
        },
        end() {
          rec.ended = true
        },
        // Unused Span surface — no-ops to satisfy the interface at cast time.
        spanContext: () => ({ traceId: '0', spanId: '0', traceFlags: 0 }),
        addEvent: () => span,
        addLink: () => span,
        addLinks: () => span,
        updateName: () => span,
        isRecording: () => true,
      }
      return span as unknown as Span
    },
    startActiveSpan: (() => {
      throw new Error('not used')
    }) as unknown as Tracer['startActiveSpan'],
  } as Tracer
  return { tracer, spans }
}

function ctx(requestId = 'req-1'): ChatMiddlewareContext {
  return {
    requestId,
    model: 'test-model',
    provider: 'openai',
  } as unknown as ChatMiddlewareContext
}

const ATTRS = {
  role: 'customer_support',
  surface: 'widget' as const,
  promptVersion: 'v9',
  configRevision: 42,
}

// The complete set of attribute keys the middleware is permitted to emit. Any
// key outside this allowlist is a leak risk and fails the test — a stricter and
// less collision-prone guard than a substring blocklist (`prompt_version` is a
// legitimate key, `gen_ai.usage.input_tokens` a legitimate count).
const ALLOWED_ATTRIBUTE_KEYS = new Set([
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.provider.name',
  'gen_ai.response.finish_reason',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.total_tokens',
  'gen_ai.tool.name',
  'quackback.assistant.role',
  'quackback.assistant.surface',
  'quackback.assistant.prompt_version',
  'quackback.assistant.config_revision',
  'quackback.assistant.tool_call_count',
  'quackback.assistant.tool.ok',
  'quackback.assistant.tool.duration_ms',
])

const SECRET_ARGS = { q: 'SECRET_CUSTOMER_QUESTION' }
const SECRET_RESULT = 'SECRET_TOOL_RESULT'
const SECRET_ANSWER = 'SECRET_ASSISTANT_ANSWER'

describe('createAssistantTracingMiddleware', () => {
  it('creates one root turn span with privacy-minimal attributes and a child span per tool call', () => {
    const { tracer, spans } = makeTestTracer()
    const mw = createAssistantTracingMiddleware(ATTRS, tracer)
    const c = ctx()

    mw.onStart!(c)
    mw.onBeforeToolCall!(c, {
      toolName: 'search_knowledge',
      toolCallId: 'call-1',
      args: SECRET_ARGS,
    } as unknown as ToolCallHookContext)
    mw.onAfterToolCall!(c, {
      toolName: 'search_knowledge',
      toolCallId: 'call-1',
      ok: true,
      duration: 12,
      result: SECRET_RESULT,
    } as unknown as AfterToolCallInfo)
    mw.onUsage!(c, {
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
    } as UsageInfo)
    mw.onFinish!(c, {
      finishReason: 'stop',
      duration: 30,
      content: SECRET_ANSWER,
    } as FinishInfo)

    const root = spans.find((s) => s.name === 'assistant.turn')!
    const tool = spans.find((s) => s.name === 'assistant.tool')!
    expect(root).toBeDefined()
    expect(tool).toBeDefined()
    expect(spans).toHaveLength(2)

    // Root: non-textual turn vocabulary only.
    expect(root.attributes['quackback.assistant.role']).toBe('customer_support')
    expect(root.attributes['quackback.assistant.surface']).toBe('widget')
    expect(root.attributes['quackback.assistant.prompt_version']).toBe('v9')
    expect(root.attributes['quackback.assistant.config_revision']).toBe(42)
    expect(root.attributes['gen_ai.request.model']).toBe('test-model')
    expect(root.attributes['gen_ai.response.finish_reason']).toBe('stop')
    expect(root.attributes['gen_ai.usage.input_tokens']).toBe(100)
    expect(root.attributes['gen_ai.usage.output_tokens']).toBe(20)
    expect(root.attributes['gen_ai.usage.total_tokens']).toBe(120)
    expect(root.attributes['quackback.assistant.tool_call_count']).toBe(1)

    // Tool child: name + outcome shape only.
    expect(tool.attributes['gen_ai.tool.name']).toBe('search_knowledge')
    expect(tool.attributes['quackback.assistant.tool.ok']).toBe(true)
    expect(tool.attributes['quackback.assistant.tool.duration_ms']).toBe(12)

    // Every span closed.
    expect(root.ended).toBe(true)
    expect(tool.ended).toBe(true)
  })

  it('accumulates token usage across agent-loop iterations (one onUsage each)', () => {
    const { tracer, spans } = makeTestTracer()
    const mw = createAssistantTracingMiddleware(ATTRS, tracer)
    const c = ctx()

    mw.onStart!(c)
    // onUsage fires once per agent-loop iteration; the running totals must sum,
    // not overwrite (the old bug undercounted a multi-iteration turn to just
    // the last slice).
    mw.onUsage!(c, { promptTokens: 100, completionTokens: 20, totalTokens: 120 } as UsageInfo)
    mw.onUsage!(c, { promptTokens: 40, completionTokens: 10, totalTokens: 50 } as UsageInfo)
    mw.onUsage!(c, { promptTokens: 30, completionTokens: 5, totalTokens: 35 } as UsageInfo)
    mw.onFinish!(c, { finishReason: 'stop', duration: 30, content: '' } as FinishInfo)

    const root = spans.find((s) => s.name === 'assistant.turn')!
    expect(root.attributes['gen_ai.usage.input_tokens']).toBe(170)
    expect(root.attributes['gen_ai.usage.output_tokens']).toBe(35)
    expect(root.attributes['gen_ai.usage.total_tokens']).toBe(205)
  })

  it('never puts tool args, tool results, or customer text on any span', () => {
    const { tracer, spans } = makeTestTracer()
    const mw = createAssistantTracingMiddleware(ATTRS, tracer)
    const c = ctx()

    mw.onStart!(c)
    mw.onBeforeToolCall!(c, {
      toolName: 'set_attribute',
      toolCallId: 'call-1',
      args: SECRET_ARGS,
    } as unknown as ToolCallHookContext)
    mw.onAfterToolCall!(c, {
      toolName: 'set_attribute',
      toolCallId: 'call-1',
      ok: false,
      duration: 5,
      error: SECRET_RESULT,
    } as unknown as AfterToolCallInfo)
    mw.onFinish!(c, { finishReason: 'stop', duration: 10, content: SECRET_ANSWER } as FinishInfo)

    for (const span of spans) {
      for (const [key, value] of Object.entries(span.attributes)) {
        expect(ALLOWED_ATTRIBUTE_KEYS.has(key), `attribute key "${key}" is not allow-listed`).toBe(
          true
        )
        const serialized = JSON.stringify(value)
        expect(serialized).not.toContain('SECRET_CUSTOMER_QUESTION')
        expect(serialized).not.toContain(SECRET_RESULT)
        expect(serialized).not.toContain(SECRET_ANSWER)
      }
    }
  })

  it('marks the root span errored and records the infra exception on onError', () => {
    const { tracer, spans } = makeTestTracer()
    const mw = createAssistantTracingMiddleware(ATTRS, tracer)
    const c = ctx()
    const err = new Error('502 bad gateway')

    mw.onStart!(c)
    mw.onError!(c, { error: err, duration: 3 } as ErrorInfo)

    const root = spans.find((s) => s.name === 'assistant.turn')!
    expect(root.ended).toBe(true)
    expect(root.status?.code).toBe(2) // SpanStatusCode.ERROR
    expect(root.exceptions).toContain(err)
  })

  it('closes an open tool span if the turn ends before onAfterToolCall', () => {
    const { tracer, spans } = makeTestTracer()
    const mw = createAssistantTracingMiddleware(ATTRS, tracer)
    const c = ctx()

    mw.onStart!(c)
    mw.onBeforeToolCall!(c, {
      toolName: 'search_knowledge',
      toolCallId: 'call-1',
      args: {},
    } as unknown as ToolCallHookContext)
    mw.onFinish!(c, { finishReason: 'stop', duration: 10, content: '' } as FinishInfo)

    // Both the root and the orphaned tool span must be closed.
    expect(spans.every((s) => s.ended)).toBe(true)
  })

  it('keeps sequential chat() invocations (same middleware instance) as separate turns', () => {
    const { tracer, spans } = makeTestTracer()
    const mw = createAssistantTracingMiddleware(ATTRS, tracer)

    mw.onStart!(ctx('req-1'))
    mw.onFinish!(ctx('req-1'), { finishReason: 'stop', duration: 1, content: '' } as FinishInfo)
    mw.onStart!(ctx('req-2'))
    mw.onFinish!(ctx('req-2'), { finishReason: 'stop', duration: 1, content: '' } as FinishInfo)

    const turns = spans.filter((s) => s.name === 'assistant.turn')
    expect(turns).toHaveLength(2)
    expect(turns.every((s) => s.ended)).toBe(true)
  })
})
