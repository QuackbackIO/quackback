// @vitest-environment node
/**
 * Tests for the dynamic response-compression layer.
 *
 * Nitro serves static assets uncompressed on the bare Bun preset (no
 * reverse proxy in front of a self-hosted install), and SSR documents and
 * server-function JSON never touch a compressor at all. maybeCompress
 * closes that gap for anything that streams through the request pipeline,
 * while leaving already-encoded, tiny, or event-stream responses alone.
 */
import { describe, it, expect, vi } from 'vitest'
import zlib from 'node:zlib'
import { maybeCompress } from '../compression'

// Records every encoder the module creates, so a test can see whether it was
// released. Everything else is the real node:zlib.
const encoders = vi.hoisted(() => [] as { destroyed: boolean }[])
vi.mock('node:zlib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:zlib')>()
  const record = <T extends { destroyed: boolean }>(encoder: T) => (encoders.push(encoder), encoder)
  const wrapped = {
    ...actual,
    createGzip: (...args: Parameters<typeof actual.createGzip>) =>
      record(actual.createGzip(...args)),
    createBrotliCompress: (...args: Parameters<typeof actual.createBrotliCompress>) =>
      record(actual.createBrotliCompress(...args)),
  }
  return { ...wrapped, default: wrapped }
})

/** Exceeds the compression size floor; large enough to compress meaningfully. */
const bigHtml = '<!doctype html><html><body>' + '<p>hello world</p>'.repeat(200) + '</body></html>'
const bigJson = JSON.stringify({
  items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: 'item-' + i })),
})

function htmlResponse(body: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...extraHeaders },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

describe('maybeCompress', () => {
  it('compresses a large HTML response with brotli when the client accepts it', async () => {
    const res = await maybeCompress(htmlResponse(bigHtml), 'gzip, deflate, br')
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(res.headers.get('vary')).toMatch(/Accept-Encoding/)
    expect(res.headers.has('content-length')).toBe(false)
    const compressed = await readAll(res.body!)
    expect(compressed.length).toBeLessThan(Buffer.byteLength(bigHtml))
    expect(zlib.brotliDecompressSync(compressed).toString('utf-8')).toBe(bigHtml)
  })

  it('appends to, rather than replaces, a Vary the response already carries', async () => {
    const res = await maybeCompress(htmlResponse(bigHtml, { vary: 'Host' }), 'br')
    expect(res.headers.get('vary')).toBe('Host, Accept-Encoding')
  })

  it('falls back to gzip when the client does not accept brotli', async () => {
    const res = await maybeCompress(htmlResponse(bigHtml), 'gzip')
    expect(res.headers.get('content-encoding')).toBe('gzip')
    const compressed = await readAll(res.body!)
    expect(zlib.gunzipSync(compressed).toString('utf-8')).toBe(bigHtml)
  })

  it('compresses compressible JSON bodies', async () => {
    const res = await maybeCompress(
      new Response(bigJson, { headers: { 'content-type': 'application/json; charset=utf-8' } }),
      'br'
    )
    expect(res.headers.get('content-encoding')).toBe('br')
    const compressed = await readAll(res.body!)
    expect(zlib.brotliDecompressSync(compressed).toString('utf-8')).toBe(bigJson)
  })

  it('never touches text/event-stream, regardless of Accept-Encoding', async () => {
    const res = await maybeCompress(
      htmlResponse(bigHtml, { 'content-type': 'text/event-stream; charset=utf-8' }),
      'gzip, br'
    )
    expect(res.headers.has('content-encoding')).toBe(false)
    const body = await readAll(res.body!)
    expect(body.toString('utf-8')).toBe(bigHtml)
  })

  it('skips bodies under the compression floor', async () => {
    const small = 'ok'
    const res = await maybeCompress(
      new Response(small, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-length': String(Buffer.byteLength(small)),
        },
      }),
      'gzip, br'
    )
    expect(res.headers.has('content-encoding')).toBe(false)
  })

  it('skips when Accept-Encoding names no supported encoding', async () => {
    const res = await maybeCompress(htmlResponse(bigHtml), 'identity')
    expect(res.headers.has('content-encoding')).toBe(false)
  })

  it('skips when Accept-Encoding is absent', async () => {
    const res = await maybeCompress(htmlResponse(bigHtml), '')
    expect(res.headers.has('content-encoding')).toBe(false)
  })

  it('honours a q=0 exclusion', async () => {
    const res = await maybeCompress(htmlResponse(bigHtml), 'br;q=0, gzip')
    expect(res.headers.get('content-encoding')).toBe('gzip')
  })

  it('never double-compresses a response that already carries Content-Encoding', async () => {
    const already = htmlResponse(bigHtml, { 'content-encoding': 'br' })
    const res = await maybeCompress(already, 'gzip, br')
    expect(res).toBe(already)
  })

  it('leaves a partial (range) response untouched: its byte range is of the raw body', async () => {
    const res = new Response(bigHtml, {
      status: 206,
      headers: { 'content-type': 'text/plain', 'content-range': 'bytes 0-99/5000' },
    })
    const out = await maybeCompress(res, 'br')
    expect(out).toBe(res)
  })

  it('honours Cache-Control: no-transform', async () => {
    const res = htmlResponse(bigHtml, { 'cache-control': 'public, no-transform' })
    expect(await maybeCompress(res, 'br')).toBe(res)
  })

  it('weakens a strong ETag, since the encoded bytes differ from the original', async () => {
    const strong = await maybeCompress(htmlResponse(bigHtml, { etag: '"abc"' }), 'br')
    expect(strong.headers.get('etag')).toBe('W/"abc"')
    const weak = await maybeCompress(htmlResponse(bigHtml, { etag: 'W/"abc"' }), 'br')
    expect(weak.headers.get('etag')).toBe('W/"abc"')
  })

  it('leaves a response with no body untouched', async () => {
    const noBody = new Response(null, { status: 204 })
    const res = await maybeCompress(noBody, 'gzip, br')
    expect(res).toBe(noBody)
  })

  it('releases the encoder when the client goes away mid-stream', async () => {
    const encoder = new TextEncoder()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        // A document that never finishes: the client leaves first.
        controller.enqueue(encoder.encode(bigHtml))
      },
    })
    const compressed = await maybeCompress(
      new Response(source, { headers: { 'content-type': 'text/html' } }),
      'br'
    )
    const reader = compressed.body!.getReader()
    await reader.read()
    await reader.cancel()

    await vi.waitFor(() => expect(encoders.at(-1)?.destroyed).toBe(true))
  })

  it('streams output progressively instead of buffering the whole body first', async () => {
    // Three chunks trickled in with a real delay between them. A compressor
    // that only flushes at stream end would deliver everything in one lump
    // right at close; a per-chunk flush delivers each one as it is written.
    let push!: (chunk: string) => void
    let finish!: () => void
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        push = (chunk) => controller.enqueue(encoder.encode(chunk))
        finish = () => controller.close()
      },
    })
    const response = new Response(source, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
    const compressed = await maybeCompress(response, 'gzip')
    const reader = compressed.body!.getReader()

    const chunkSize = 4000
    const arrivals: number[] = []
    const readLoop = (async () => {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.length > 5) arrivals.push(performance.now())
      }
    })()

    const start = performance.now()
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      // Non-repeating filler so each chunk still produces real compressed bytes.
      push(('<p>' + i + '-' + Math.random().toString(36).slice(2) + '</p>').repeat(chunkSize / 20))
    }
    const lastEnqueueAt = performance.now() - start
    finish()
    await readLoop

    expect(arrivals.length).toBeGreaterThanOrEqual(4) // one flush per push, plus the brotli/gzip header
    // At least one real output chunk must have arrived before the input
    // finished sending, i.e. this is not "buffer everything, flush at close".
    expect(arrivals[0]! - start).toBeLessThan(lastEnqueueAt)
  })
})
