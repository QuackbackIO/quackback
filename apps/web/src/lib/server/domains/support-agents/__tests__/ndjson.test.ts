import { expect, it, vi } from 'vitest'
import { ndjsonTextChunks } from '../ndjson'
function body(value: string, cancel = vi.fn()) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value))
      controller.close()
    },
    cancel,
  })
}
async function collect(stream: ReadableStream<Uint8Array>) {
  const parts = []
  for await (const text of ndjsonTextChunks(stream)) parts.push(text)
  return parts
}
it('decodes complete and final lines as text chunks', async () => {
  expect(await collect(body('{"text":"one"}\n{"text":"two"}'))).toEqual(['one', 'two'])
})
it('caps UTF-8 bytes even when a complete line arrived in one chunk', async () => {
  await expect(
    collect(body(JSON.stringify({ text: '💡'.repeat(5000) }) + '\n'))
  ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
})
it('rejects a line that does not contain text', async () => {
  await expect(collect(body('{"content":"no"}\n'))).rejects.toMatchObject({
    code: 'VALIDATION_ERROR',
  })
})
it('cancels a stalled reader after its idle limit', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn()
  try {
    const rejected = expect(collect(new ReadableStream({ cancel }))).rejects.toMatchObject({
      code: 'STREAM_IDLE',
    })
    await vi.advanceTimersByTimeAsync(5001)
    await rejected
    expect(cancel).toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})
