// @vitest-environment happy-dom
/**
 * Characterization tests for useConversationStream ahead of the thread
 * extraction refactor. Pins the current reconnect contract:
 *  - the EventSource is recreated on error with a FRESH URL from buildUrl
 *    (token re-mint per attempt) after an exponential backoff
 *  - onReconnect fires only after a successful RE-connect, never the first open
 *  - a null buildUrl result (mint failure) schedules a retry
 *  - unmount closes the stream and cancels any pending reconnect timer
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useConversationStream } from '../use-conversation-stream'

class MockEventSource {
  static instances: MockEventSource[] = []
  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  private listeners = new Map<string, Array<(e: { data: string }) => void>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(name: string, handler: (e: { data: string }) => void) {
    const list = this.listeners.get(name) ?? []
    list.push(handler)
    this.listeners.set(name, list)
  }

  emit(name: string, data: unknown) {
    for (const handler of this.listeners.get(name) ?? []) {
      handler({ data: JSON.stringify(data) })
    }
  }
}

/** Flush pending microtasks (the hook's connect() awaits buildUrl). */
const flush = () => act(async () => {})

/** Advance fake timers, then let the async reconnect settle. */
const advance = async (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
  await flush()
}

beforeEach(() => {
  vi.useFakeTimers()
  MockEventSource.instances = []
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useConversationStream', () => {
  it('connects with the URL from buildUrl and delivers parsed named events', async () => {
    const onEvent = vi.fn()
    renderHook(() =>
      useConversationStream({
        buildUrl: async () => '/api/chat/stream?token=one',
        enabled: true,
        onEvent,
      })
    )
    await flush()

    expect(MockEventSource.instances).toHaveLength(1)
    const es = MockEventSource.instances[0]
    expect(es.url).toBe('/api/chat/stream?token=one')

    act(() => {
      es.emit('message', { kind: 'message', conversationId: 'conversation_1' })
    })
    expect(onEvent).toHaveBeenCalledWith({ kind: 'message', conversationId: 'conversation_1' })
  })

  it('does not connect when disabled', async () => {
    const buildUrl = vi.fn(async () => '/url')
    renderHook(() => useConversationStream({ buildUrl, enabled: false, onEvent: vi.fn() }))
    await flush()
    expect(buildUrl).not.toHaveBeenCalled()
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('reconnects on error with exponential backoff, re-minting the URL per attempt', async () => {
    let mint = 0
    const buildUrl = vi.fn(async () => `/stream?token=${++mint}`)
    renderHook(() => useConversationStream({ buildUrl, enabled: true, onEvent: vi.fn() }))
    await flush()

    expect(MockEventSource.instances).toHaveLength(1)
    const first = MockEventSource.instances[0]

    // First error: the source is closed and a retry is scheduled at 2s
    // (retry=1 -> 1000 * 2^1).
    act(() => first.onerror?.())
    expect(first.close).toHaveBeenCalled()
    await advance(1999)
    expect(MockEventSource.instances).toHaveLength(1)
    await advance(1)
    expect(MockEventSource.instances).toHaveLength(2)

    // The second attempt minted a FRESH token.
    expect(buildUrl).toHaveBeenCalledTimes(2)
    expect(MockEventSource.instances[1].url).toBe('/stream?token=2')

    // Second consecutive error (no open in between): backoff doubles to 4s.
    act(() => MockEventSource.instances[1].onerror?.())
    await advance(3999)
    expect(MockEventSource.instances).toHaveLength(2)
    await advance(1)
    expect(MockEventSource.instances).toHaveLength(3)
    expect(MockEventSource.instances[2].url).toBe('/stream?token=3')
  })

  it('fires onReconnect only after a successful reconnect, not the first open', async () => {
    const onReconnect = vi.fn()
    renderHook(() =>
      useConversationStream({
        buildUrl: async () => '/stream',
        enabled: true,
        onEvent: vi.fn(),
        onReconnect,
      })
    )
    await flush()

    const first = MockEventSource.instances[0]
    act(() => first.onopen?.())
    expect(onReconnect).not.toHaveBeenCalled()

    act(() => first.onerror?.())
    await advance(2000)
    expect(MockEventSource.instances).toHaveLength(2)

    act(() => MockEventSource.instances[1].onopen?.())
    expect(onReconnect).toHaveBeenCalledTimes(1)

    // A successful open resets the backoff: the next error retries at 2s again.
    act(() => MockEventSource.instances[1].onerror?.())
    await advance(2000)
    expect(MockEventSource.instances).toHaveLength(3)
  })

  it('schedules a retry when buildUrl resolves null (token mint failed)', async () => {
    let attempt = 0
    const buildUrl = vi.fn(async () => (attempt++ === 0 ? null : '/stream?token=recovered'))
    renderHook(() => useConversationStream({ buildUrl, enabled: true, onEvent: vi.fn() }))
    await flush()

    // No source yet - the mint failed.
    expect(buildUrl).toHaveBeenCalledTimes(1)
    expect(MockEventSource.instances).toHaveLength(0)

    await advance(2000)
    expect(buildUrl).toHaveBeenCalledTimes(2)
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/stream?token=recovered')
  })

  it('cleans up on unmount: closes the source and cancels pending reconnects', async () => {
    const buildUrl = vi.fn(async () => '/stream')
    const { unmount } = renderHook(() =>
      useConversationStream({ buildUrl, enabled: true, onEvent: vi.fn() })
    )
    await flush()

    const es = MockEventSource.instances[0]
    unmount()
    expect(es.close).toHaveBeenCalled()

    // No zombie reconnects after unmount.
    await advance(60_000)
    expect(MockEventSource.instances).toHaveLength(1)
    expect(buildUrl).toHaveBeenCalledTimes(1)
  })

  it('does not reconnect after unmount even with an error already scheduled', async () => {
    const buildUrl = vi.fn(async () => '/stream')
    const { unmount } = renderHook(() =>
      useConversationStream({ buildUrl, enabled: true, onEvent: vi.fn() })
    )
    await flush()

    act(() => MockEventSource.instances[0].onerror?.())
    unmount()
    await advance(60_000)
    expect(MockEventSource.instances).toHaveLength(1)
    expect(buildUrl).toHaveBeenCalledTimes(1)
  })
})

describe('useConversationStream - polling fallback (Phase 6 R2)', () => {
  it('poll mode never opens an EventSource and never mints a URL', async () => {
    const buildUrl = vi.fn(async () => '/stream')
    const poll = vi.fn(async () => {})
    renderHook(() =>
      useConversationStream({
        buildUrl,
        enabled: true,
        onEvent: vi.fn(),
        mode: 'poll',
        poll,
        pollIntervalMs: 5000,
      })
    )
    await flush()

    expect(MockEventSource.instances).toHaveLength(0)
    expect(buildUrl).not.toHaveBeenCalled()
    // Catches up immediately, then keeps polling on the interval.
    expect(poll).toHaveBeenCalledTimes(1)
    await advance(5000)
    expect(poll).toHaveBeenCalledTimes(2)
    await advance(5000)
    expect(poll).toHaveBeenCalledTimes(3)
  })

  it('polls when the browser has no EventSource', async () => {
    vi.stubGlobal('EventSource', undefined)
    const poll = vi.fn(async () => {})
    renderHook(() =>
      useConversationStream({
        buildUrl: async () => '/stream',
        enabled: true,
        onEvent: vi.fn(),
        poll,
        pollIntervalMs: 5000,
      })
    )
    await flush()
    expect(poll).toHaveBeenCalledTimes(1)
    await advance(5000)
    expect(poll).toHaveBeenCalledTimes(2)
  })

  it('degrades to polling after repeated SSE failures, then stops reconnecting', async () => {
    const poll = vi.fn(async () => {})
    renderHook(() =>
      useConversationStream({
        buildUrl: async () => '/stream',
        enabled: true,
        onEvent: vi.fn(),
        poll,
        pollIntervalMs: 5000,
      })
    )
    await flush()
    expect(MockEventSource.instances).toHaveLength(1)

    // Four consecutive failures (no open in between). The first three schedule
    // a reconnect (2s, 4s, 8s); the fourth crosses the threshold and degrades.
    act(() => MockEventSource.instances[0].onerror?.())
    await advance(2000)
    act(() => MockEventSource.instances[1].onerror?.())
    await advance(4000)
    act(() => MockEventSource.instances[2].onerror?.())
    await advance(8000)
    expect(MockEventSource.instances).toHaveLength(4)
    expect(poll).not.toHaveBeenCalled()

    act(() => MockEventSource.instances[3].onerror?.())
    await flush()
    // Degraded: caught up immediately via poll, and no 5th EventSource opens
    // even after a long wait.
    expect(poll).toHaveBeenCalledTimes(1)
    await advance(60_000)
    expect(MockEventSource.instances).toHaveLength(4)
    expect(poll.mock.calls.length).toBeGreaterThan(1)
  })

  it('a successful open resets the failure count so a later blip does not degrade early', async () => {
    const poll = vi.fn(async () => {})
    renderHook(() =>
      useConversationStream({
        buildUrl: async () => '/stream',
        enabled: true,
        onEvent: vi.fn(),
        poll,
        pollIntervalMs: 5000,
      })
    )
    await flush()

    // Three failures, then a successful open (resets), then three more: still
    // under the threshold, so it keeps streaming rather than polling.
    for (let i = 0; i < 3; i++) {
      act(() => MockEventSource.instances.at(-1)!.onerror?.())
      await advance(30_000)
    }
    act(() => MockEventSource.instances.at(-1)!.onopen?.())
    for (let i = 0; i < 3; i++) {
      act(() => MockEventSource.instances.at(-1)!.onerror?.())
      await advance(30_000)
    }
    expect(poll).not.toHaveBeenCalled()
    expect(MockEventSource.instances.length).toBeGreaterThan(4)
  })

  it('without a poll callback it keeps retrying SSE (unchanged legacy behavior)', async () => {
    renderHook(() =>
      useConversationStream({
        buildUrl: async () => '/stream',
        enabled: true,
        onEvent: vi.fn(),
      })
    )
    await flush()
    // Many failures, no poll callback -> never degrades, always reconnects.
    for (let i = 0; i < 6; i++) {
      act(() => MockEventSource.instances.at(-1)!.onerror?.())
      await advance(30_000)
    }
    expect(MockEventSource.instances.length).toBeGreaterThan(6)
  })
})
