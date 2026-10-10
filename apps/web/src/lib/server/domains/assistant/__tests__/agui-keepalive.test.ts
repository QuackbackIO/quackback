import { describe, it, expect, vi, afterEach } from 'vitest'
import { withSseKeepalive } from '../agui'

afterEach(() => {
  vi.useRealTimers()
})

describe('withSseKeepalive', () => {
  it('injects SSE comments while the inner body is idle', async () => {
    vi.useFakeTimers()
    const inner = new ReadableStream<Uint8Array>({
      start() {
        // Stay open so the wrapper's interval can fire.
      },
      cancel() {},
    })
    const wrapped = withSseKeepalive(
      new Response(inner, { headers: { 'content-type': 'text/event-stream' } }),
      2_000
    )
    const reader = wrapped.body!.getReader()
    const decoded = reader.read().then((r) => new TextDecoder().decode(r.value))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(await decoded).toBe(': keepalive\n\n')
    await reader.cancel()
  })
})
