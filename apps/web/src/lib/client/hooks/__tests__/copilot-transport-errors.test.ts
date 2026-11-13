// @vitest-environment happy-dom
/**
 * A transport failure on an assistant surface (a dropped stream, a reply that
 * was never ours) reaches the person as plain wording, never as the browser's
 * or the stream library's own message.
 *
 * Both hooks are driven through their real code; only the network seam under
 * each is replaced, and it hands back the error the transport would.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ConversationId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  chatOptions: null as { onError: (error: Error) => void } | null,
  runOptions: null as { onError: (error: Error) => void } | null,
  finishRun: null as (() => void) | null,
  toastErrorLine: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@tanstack/ai-react', () => ({
  fetchServerSentEvents: () => ({}),
  useChat: (options: { onError: (error: Error) => void }) => {
    hoisted.chatOptions = options
    return {
      // The stream fails mid-turn: the library reports it, then settles.
      sendMessage: async () => {},
      stop: vi.fn(),
      clear: vi.fn(),
      setMessages: vi.fn(),
      messages: [],
      isLoading: false,
    }
  },
}))

vi.mock('@/lib/client/utils/agui-run', () => ({
  runAguiTurn: (options: { onError: (error: Error) => void }) => {
    hoisted.runOptions = options
    return {
      stop: vi.fn(),
      done: new Promise<void>((resolve) => {
        hoisted.finishRun = resolve
      }),
    }
  },
}))

vi.mock('@/lib/client/error-notice', () => ({
  toastErrorLine: hoisted.toastErrorLine,
  toastError: hoisted.toastError,
}))

const { useAguiTurn } = await import('../use-agui-turn')
const { useCopilotTransform } = await import('../use-copilot-transform')
const { GENERIC_ERROR } = await import('@/lib/client/utils/http-error')

const LIBRARY_MESSAGE = 'Stream response body read failed'

function named(name: string, message: string): Error {
  const error = new Error(message)
  error.name = name
  return error
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.chatOptions = null
  hoisted.runOptions = null
  hoisted.finishRun = null
})

describe('useAguiTurn', () => {
  async function startTurn() {
    const onError = vi.fn()
    const { result } = renderHook(() => useAguiTurn({ url: '/api/admin/assistant/copilot' }))
    await act(() =>
      result.current.start({ question: 'Why?', handlers: { onFinal: vi.fn(), onError } })
    )
    return onError
  }

  it("replaces the stream library's message with plain wording", async () => {
    const onError = await startTurn()
    act(() => hoisted.chatOptions!.onError(new Error(LIBRARY_MESSAGE)))
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(GENERIC_ERROR)
  })

  it('says nothing when the person stopped the turn themselves', async () => {
    const onError = await startTurn()
    act(() => hoisted.chatOptions!.onError(named('AbortError', 'The operation was aborted.')))
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports a failed turn once, however many times the transport does', async () => {
    const onError = await startTurn()
    act(() => {
      hoisted.chatOptions!.onError(new Error(LIBRARY_MESSAGE))
      hoisted.chatOptions!.onError(new Error('HTTP error! status: 502'))
    })
    expect(onError).toHaveBeenCalledTimes(1)
  })
})

describe('useCopilotTransform', () => {
  it("toasts plain wording, not the transport's message, and resolves to null", async () => {
    const item = { kind: 'conversation', id: 'conversation_1' as ConversationId } as const
    const { result } = renderHook(() => useCopilotTransform(item))
    let outcome: Promise<string | null> | undefined
    act(() => {
      outcome = result.current('more_concise', 'A long reply')
    })
    hoisted.runOptions!.onError(new Error(LIBRARY_MESSAGE))
    hoisted.finishRun!()

    await expect(outcome).resolves.toBeNull()
    expect(hoisted.toastErrorLine).toHaveBeenCalledTimes(1)
    expect(hoisted.toastErrorLine).toHaveBeenCalledWith(GENERIC_ERROR)
    expect(hoisted.toastError).not.toHaveBeenCalled()
  })
})
