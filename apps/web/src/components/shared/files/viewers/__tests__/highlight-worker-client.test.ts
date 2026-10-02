import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleHighlightRequest, type HighlightRequest } from '../highlight-lines'
import { createCodeHighlighter } from '../highlight-worker-client'
import { highlightedLineCount, tokensFor } from '../text-lines'

/**
 * Stands in for the browser Worker: the same message protocol, answered by
 * the real highlighting code when the test lets it, in any order.
 */
class InProcessWorker {
  static instances: InProcessWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  terminated = false
  received: HighlightRequest[] = []

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions
  ) {
    InProcessWorker.instances.push(this)
  }

  postMessage(message: HighlightRequest) {
    this.received.push(message)
  }

  /** Answers the request it received `index`-th. */
  answer(index: number) {
    if (this.terminated) return
    const data = handleHighlightRequest(this.received[index]!)
    this.onmessage?.(new MessageEvent('message', { data }))
  }

  terminate() {
    this.terminated = true
  }
}

beforeEach(() => {
  InProcessWorker.instances = []
  vi.stubGlobal('Worker', InProcessWorker)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createCodeHighlighter', () => {
  it('starts the highlight worker as a module worker', () => {
    createCodeHighlighter()
    const [worker] = InProcessWorker.instances
    expect(worker!.url.pathname).toMatch(/\/highlight\.worker\.ts$/)
    expect(worker!.options).toEqual({ type: 'module', name: 'code-highlighter' })
  })

  it('settles each request with its own answer, whatever order they come back in', async () => {
    const highlighter = createCodeHighlighter()
    const first = highlighter.highlight('const a = 1', 'javascript')
    const second = highlighter.highlight('x\ny', 'klingon')
    const third = highlighter.highlight('a\nb\nc', 'python')
    const [worker] = InProcessWorker.instances
    expect(worker!.received.map((r) => r.text)).toEqual(['const a = 1', 'x\ny', 'a\nb\nc'])
    worker!.answer(2)
    worker!.answer(0)
    worker!.answer(1)
    const lines = (await first)!
    expect(tokensFor({ kind: 'highlighted', lines }, 0, 'const a = 1')[0]).toEqual({
      text: 'const',
      cls: 'hljs-keyword',
    })
    await expect(second).resolves.toBeNull()
    expect(highlightedLineCount((await third)!)).toBe(3)
  })

  it('rejects what is waiting when the worker fails, and anything asked after', async () => {
    const highlighter = createCodeHighlighter()
    const waiting = highlighter.highlight('const a = 1', 'javascript')
    const [worker] = InProcessWorker.instances
    worker!.onerror?.(new Event('error'))
    await expect(waiting).rejects.toThrow()
    expect(worker!.terminated).toBe(true)
    await expect(highlighter.highlight('b', 'javascript')).rejects.toThrow()
  })

  it('stops the worker and rejects what is waiting when terminated', async () => {
    const highlighter = createCodeHighlighter()
    const waiting = highlighter.highlight('const a = 1', 'javascript')
    highlighter.terminate()
    const [worker] = InProcessWorker.instances
    expect(worker!.terminated).toBe(true)
    await expect(waiting).rejects.toThrow()
    await expect(highlighter.highlight('b', 'javascript')).rejects.toThrow()
    expect(worker!.received).toHaveLength(1)
  })
})
