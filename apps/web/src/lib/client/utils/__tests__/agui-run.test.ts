// @vitest-environment happy-dom
/**
 * The client AG-UI surfaces driven through the REAL @tanstack/ai-client
 * ChatClient and @tanstack/ai-react useChat; only `fetch` is replaced, and it
 * answers with the wire the assistant routes emit (one canonical RUN_STARTED
 * ... RUN_FINISHED pair, STEP_STARTED activity, the final payload on
 * RUN_FINISHED.result). Pins what the turn handlers depend on: every chunk
 * reaches onChunk, a run settles exactly once, a non-2xx envelope arrives as a
 * RUN_ERROR carrying the server's message, and the request carries a threadId
 * and the forwarded props.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { StreamChunk } from '@tanstack/ai'
import { runAguiTurn } from '../agui-run'
import { useAguiTurn } from '../../hooks/use-agui-turn'

interface RunAgentInput {
  threadId: string
  runId: string
  messages: Array<{ role: string; content?: unknown }>
  forwardedProps: Record<string, unknown>
}

function wire(input: RunAgentInput, text: string, result: unknown): Response {
  const ids = { threadId: input.threadId, runId: input.runId }
  const frames = [
    { type: 'RUN_STARTED', ...ids },
    { type: 'STEP_STARTED', stepName: 'thinking' },
    { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
    { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: JSON.stringify({ text }) },
    { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
    { type: 'RUN_FINISHED', ...ids, finishReason: 'stop', result },
  ]
  const body = frames.map((f) => `data: ${JSON.stringify({ ...f, timestamp: 1 })}\n\n`).join('')
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
}

const requests: RunAgentInput[] = []

function stubFetch(reply: (input: RunAgentInput) => Response): void {
  requests.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const input = JSON.parse(String(init?.body)) as RunAgentInput
      requests.push(input)
      return reply(input)
    })
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runAguiTurn', () => {
  it('delivers every wire chunk and settles once on RUN_FINISHED', async () => {
    stubFetch((input) => wire(input, 'Rewritten', { kind: 'final', text: 'Rewritten' }))
    const chunks: StreamChunk[] = []
    const onError = vi.fn()

    const run = runAguiTurn({
      url: '/api/admin/assistant/transform',
      message: 'source text',
      forwardedProps: { transform: 'shorten' },
      onChunk: (c) => chunks.push(c),
      onError,
    })
    await run.done

    expect(onError).not.toHaveBeenCalled()
    expect(chunks.map((c) => c.type)).toEqual([
      'RUN_STARTED',
      'STEP_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ])
    const finished = chunks.at(-1) as { result?: unknown }
    expect(finished.result).toEqual({ kind: 'final', text: 'Rewritten' })

    expect(requests).toHaveLength(1)
    expect(requests[0].threadId).toMatch(/\S/)
    expect(requests[0].forwardedProps).toEqual({ transform: 'shorten' })
    expect(requests[0].messages.at(-1)).toMatchObject({ role: 'user', content: 'source text' })
  })

  it('turns a non-2xx envelope into a RUN_ERROR with the server message', async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ error: { message: 'AI limit reached for this month' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
    )
    const chunks: StreamChunk[] = []

    const run = runAguiTurn({
      url: '/api/admin/assistant/transform',
      message: 'source text',
      forwardedProps: {},
      onChunk: (c) => chunks.push(c),
    })
    await run.done

    const error = chunks.find((c) => c.type === 'RUN_ERROR') as
      { code?: string; message?: string } | undefined
    expect(error).toMatchObject({ code: 'http_429', message: 'AI limit reached for this month' })
  })
})

describe('useAguiTurn', () => {
  it('keeps one thread across turns, re-sends history and finalizes each turn once', async () => {
    let turn = 0
    stubFetch((input) => {
      turn += 1
      return wire(input, `answer ${turn}`, { answer: `answer ${turn}` })
    })
    const { result } = renderHook(() => useAguiTurn({ url: '/api/admin/assistant/copilot' }))

    const finals: unknown[] = []
    const activity: string[] = []
    const texts: string[] = []
    const handlers = {
      onFinal: (p: unknown) => finals.push(p),
      onError: vi.fn(),
      onActivity: (s: string) => activity.push(s),
      onTextDelta: (_d: string, full: string) => texts.push(full),
    }

    await act(() => result.current.start({ question: 'First?', handlers }))
    await act(() =>
      result.current.start({ question: 'Second?', forwardedProps: { ref: 'x' }, handlers })
    )

    expect(handlers.onError).not.toHaveBeenCalled()
    expect(finals).toEqual([{ answer: 'answer 1' }, { answer: 'answer 2' }])
    expect(activity).toEqual(['thinking', 'thinking'])
    expect(texts).toEqual(['answer 1', 'answer 2'])

    expect(requests).toHaveLength(2)
    expect(requests[1].threadId).toBe(requests[0].threadId)
    expect(requests[1].forwardedProps).toEqual({ ref: 'x' })
    expect(requests[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
  })
})
