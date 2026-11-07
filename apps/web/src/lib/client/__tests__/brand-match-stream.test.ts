/**
 * The builder's side of the streamed brand match: steps reach the chat as
 * they arrive, even when an event is split across chunks, and the result
 * ends it; a refused request is a result, a stream with none is an error.
 */
import { describe, expect, it, vi } from 'vitest'
import { BRAND_MATCH_URL, sseEvents, streamBrandMatch } from '../brand-match-stream'

const event = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`

/** A response whose body arrives in the chunks given. */
function streamed(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } })
}

const body = { message: 'match my brand', images: [] }

describe('streamBrandMatch', () => {
  it('reports each step as it arrives, then gives the result', async () => {
    const all =
      event({ type: 'STEP_STARTED', stepName: 'Reading your screenshots' }) +
      event({ type: 'STEP_STARTED', stepName: 'Matching fonts' }) +
      event({ type: 'CUSTOM', name: 'brand-match-result', value: { ok: true, reply: 'Done.' } })
    // Split mid-event, as a network does.
    const fetcher = vi.fn(async () =>
      streamed([all.slice(0, 30), all.slice(30, 90), all.slice(90)])
    )
    const steps: string[] = []
    const result = await streamBrandMatch(body, (s) => steps.push(s), fetcher as never)
    expect(fetcher).toHaveBeenCalledWith(
      BRAND_MATCH_URL,
      expect.objectContaining({ method: 'POST' })
    )
    expect(steps).toEqual(['Reading your screenshots', 'Matching fonts'])
    expect(result).toEqual({ ok: true, reply: 'Done.' })
  })

  it('gives a refused request as a result', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'The screenshots could not be read.' } }), {
          status: 400,
        })
    )
    expect(await streamBrandMatch(body, () => {}, fetcher as never)).toEqual({
      ok: false,
      code: 'AI_FAILED',
      message: 'The screenshots could not be read.',
    })
  })

  it('throws when the stream ends without a result', async () => {
    const fetcher = vi.fn(async () => streamed([event({ type: 'STEP_STARTED', stepName: 'x' })]))
    await expect(streamBrandMatch(body, () => {}, fetcher as never)).rejects.toThrow()
  })

  it('skips lines that are not events', () => {
    expect(sseEvents(': keepalive\n\ndata: [DONE]\n\ndata: {bad\n\n' + event({ a: 1 }))).toEqual([
      { a: 1 },
    ])
  })
})
