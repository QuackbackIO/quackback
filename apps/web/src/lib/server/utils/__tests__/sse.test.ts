/**
 * SSE writer liveness: heartbeatPing must distinguish a live consumer from
 * a queue that nobody is draining.
 */
import { describe, expect, it, vi } from 'vitest'
import { createSseStream } from '../sse'

describe('createSseStream.heartbeatPing', () => {
  it('reports unconsumed when the previous write is still queued', async () => {
    const sse = createSseStream()
    sse.sendRaw(': connected\n\n')
    expect(sse.heartbeatPing()).toBe('unconsumed')
    sse.close()
  })

  it('reports ok once the consumer has drained the queue', async () => {
    const sse = createSseStream()
    sse.sendRaw(': connected\n\n')
    const reader = sse.stream.getReader()
    await reader.read()
    expect(sse.heartbeatPing()).toBe('ok')
    await reader.cancel()
    sse.close()
  })

  it('reports closed after close() and does not throw', () => {
    const sse = createSseStream()
    sse.close()
    expect(sse.heartbeatPing()).toBe('closed')
  })
})

describe('createSseStream keepalive', () => {
  it('writes a comment into an idle stream every interval, so an idle timeout never sees silence', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      const reader = sse.stream.getReader()
      const decoder = new TextDecoder()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(decoder.decode((await reader.read()).value)).toBe(': keepalive\n\n')
      await vi.advanceTimersByTimeAsync(5_000)
      expect(decoder.decode((await reader.read()).value)).toBe(': keepalive\n\n')
      await reader.cancel()
      sse.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never adds to a queue the consumer has not drained, so an abandoned reader still shows', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      sse.sendRaw(': connected\n\n')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(sse.heartbeatPing()).toBe('unconsumed')
      const reader = sse.stream.getReader()
      const decoder = new TextDecoder()
      expect(decoder.decode((await reader.read()).value)).toBe(': connected\n\n')
      await reader.cancel()
      sse.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not mistake a keepalive written a moment ago for an abandoned reader', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      // The keepalive lands and the heartbeat runs before the server has
      // pulled it, as when both timers fire in one turn of the event loop.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(sse.heartbeatPing()).toBe('ok')
      sse.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('still reports a reader that never takes the keepalive on the next beat', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      await vi.advanceTimersByTimeAsync(5_000)
      expect(sse.heartbeatPing()).toBe('ok')
      await vi.advanceTimersByTimeAsync(20_000)
      expect(sse.heartbeatPing()).toBe('unconsumed')
      sse.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops writing once closed', async () => {
    vi.useFakeTimers()
    try {
      const sse = createSseStream({ keepAliveMs: 5_000 })
      sse.close()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
