/**
 * SSE writer liveness: heartbeatPing must distinguish a live consumer from
 * a queue that nobody is draining.
 */
import { describe, expect, it } from 'vitest'
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
