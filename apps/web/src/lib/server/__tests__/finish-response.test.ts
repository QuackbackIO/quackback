// @vitest-environment node
/**
 * The last step before a response leaves the process, applied by the server
 * entry to the framework's final response.
 */
import { describe, it, expect, vi } from 'vitest'
import zlib from 'node:zlib'
import { finishResponse } from '../finish-response'
import { onResponseBodyEnd } from '../response-hooks'

const html = '<!doctype html><html><body>' + '<p>hello</p>'.repeat(300) + '</body></html>'
const htmlResponse = () => new Response(html, { headers: { 'content-type': 'text/html' } })
const request = (acceptEncoding?: string) =>
  new Request('http://localhost/', {
    headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {},
  })

describe('finishResponse', () => {
  it('compresses for a client that accepts it', async () => {
    const sent = await finishResponse(request('br'), htmlResponse())
    expect(sent.headers.get('content-encoding')).toBe('br')
    const body = Buffer.from(await sent.arrayBuffer())
    expect(zlib.brotliDecompressSync(body).toString()).toBe(html)
  })

  it('runs a body-end hook once the body has ended, and not before', async () => {
    let finish!: () => void
    const ended = new Promise<void>((resolve) => (finish = resolve))
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(html.slice(0, 2000)))
        await ended
        controller.enqueue(encoder.encode(html.slice(2000)))
        controller.close()
      },
    })
    const response = new Response(body, { headers: { 'content-type': 'text/html' } })
    const hook = vi.fn()
    onResponseBodyEnd(response, hook)

    const sent = await finishResponse(request('br'), response)
    const reading = sent.arrayBuffer()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hook).not.toHaveBeenCalled()

    finish()
    await reading
    expect(hook).toHaveBeenCalledTimes(1)
  })

  it('leaves the body unencoded when compression is switched off', async () => {
    process.env.QUACKBACK_COMPRESSION = 'off'
    try {
      const response = htmlResponse()
      const sent = await finishResponse(request('br'), response)
      expect(sent).toBe(response)
      expect(sent.headers.get('content-encoding')).toBeNull()
    } finally {
      delete process.env.QUACKBACK_COMPRESSION
    }
  })

  it('returns the response itself when there is nothing to do', async () => {
    // Never compressed, so there is nothing to encode and nothing to vary.
    const response = new Response(html, { headers: { 'content-type': 'image/png' } })
    expect(await finishResponse(request(), response)).toBe(response)
  })
})
