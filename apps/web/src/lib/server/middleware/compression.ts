/**
 * On-the-fly response compression for SSR documents, server-function JSON
 * and any other dynamic response the request pipeline produces.
 *
 * Static assets are handled separately by Nitro's compressPublicAssets
 * (build-time gzip/brotli siblings, served by its own static handler) and
 * never reach this module. This module exists because the bare Bun preset
 * has no reverse proxy in front of it: without it, every SSR document and
 * server-function response leaves the process uncompressed.
 *
 * Uses node:zlib's streaming Gzip/BrotliCompress with an explicit flush
 * after every input chunk. The higher-level web CompressionStream API
 * buffers internally and only flushes at stream end (measured: one small
 * chunk out, then silence, then everything at once on close), which would
 * turn a progressively-streamed SSR document into a single burst at the
 * end. A per-chunk Z_PARTIAL_FLUSH / BROTLI_OPERATION_FLUSH keeps the
 * output cadence matching the input cadence.
 *
 * Applied by the server entry to the final response (`finish-response.ts`),
 * never as request middleware: the SSR handler disposes a streamed document
 * whose response a middleware replaced (see `response-hooks.ts`).
 */
import zlib from 'node:zlib'

/** Below this, the framing overhead is not worth the CPU. Matches the size
 *  floor Nitro's own build-time compressPublicAssets uses. */
const MIN_COMPRESS_BYTES = 1024

/** Quality 5 sits close to gzip's speed but compresses noticeably better
 *  (measured on a 153 KB SSR document: gzip 2.3 ms at 19.2 percent, brotli-5
 *  2.7 ms at 15.9 percent, brotli-9 16 ms at 15.5 percent, brotli-11 188 ms
 *  at 14.1 percent). This path runs on every request, so a higher quality
 *  is not worth the added latency; the widget sdk.js route affords a higher
 *  quality because its output is memoized per config, not recomputed per
 *  request. */
const DYNAMIC_BROTLI_QUALITY = 5

const COMPRESSIBLE_TYPE_RE =
  /^(text\/(?!event-stream)|application\/(json|javascript|xml|manifest\+json|ld\+json)\b|image\/svg\+xml)/i

type Encoding = 'br' | 'gzip'

function parseAcceptEncoding(header: string): Set<string> {
  const accepted = new Set<string>()
  for (const part of header.split(',')) {
    const [rawName, ...params] = part.trim().split(';')
    const name = rawName?.trim().toLowerCase()
    if (!name) continue
    const qParam = params.find((p) => p.trim().startsWith('q='))
    const q = qParam ? Number(qParam.trim().slice(2)) : 1
    if (q > 0) accepted.add(name)
  }
  return accepted
}

function pickEncoding(acceptEncoding: string): Encoding | null {
  const accepted = parseAcceptEncoding(acceptEncoding)
  if (accepted.has('br')) return 'br'
  if (accepted.has('gzip')) return 'gzip'
  return null
}

/**
 * Combines any number of comma-separated Vary values into one, case
 * insensitively deduped, preserving first-seen order, so adding
 * Accept-Encoding never drops a Vary the response already carries.
 */
function mergeVaryValues(...sources: string[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const source of sources) {
    for (const raw of source.split(',')) {
      const trimmed = raw.trim()
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue
      seen.add(trimmed.toLowerCase())
      parts.push(trimmed)
    }
  }
  return parts.join(', ')
}

function appendVary(headers: Headers, value: string) {
  const merged = mergeVaryValues(headers.get('vary') ?? '', value)
  if (merged) headers.set('vary', merged)
}

/**
 * The body compressed through node:zlib, with a flush after every input chunk
 * so the compressed output tracks the input's arrival instead of waiting for
 * the whole stream to close.
 *
 * Pull-driven: the source is read only when the server asks for more output,
 * as it would read an uncompressed body.
 */
function compressBody(
  body: ReadableStream<Uint8Array>,
  encoding: Encoding
): ReadableStream<Uint8Array> {
  const impl =
    encoding === 'br'
      ? zlib.createBrotliCompress({
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: DYNAMIC_BROTLI_QUALITY },
        })
      : zlib.createGzip()
  const flushOp =
    encoding === 'br' ? zlib.constants.BROTLI_OPERATION_FLUSH : zlib.constants.Z_PARTIAL_FLUSH

  const compressed: Uint8Array[] = []
  impl.on('data', (chunk: Buffer) =>
    compressed.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
  )
  const write = (chunk: Uint8Array) =>
    new Promise<void>((resolve, reject) => {
      impl.write(chunk, (err) => {
        if (err) reject(err)
        else impl.flush(flushOp, () => resolve())
      })
    })
  // Resolved by zlib's own 'end' event, not the .end() callback: the callback
  // can fire while a last 'data' event is still to come.
  const end = () =>
    new Promise<void>((resolve, reject) => {
      impl.once('end', () => resolve())
      impl.once('error', reject)
      impl.end()
    })

  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Feed the encoder until it has output to hand over, or the body ends.
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          await end()
          for (const chunk of compressed.splice(0)) controller.enqueue(chunk)
          controller.close()
          return
        }
        await write(value)
        if (compressed.length) {
          for (const chunk of compressed.splice(0)) controller.enqueue(chunk)
          return
        }
      }
    },
    // The client went away or the body errored: release the encoder's native
    // state now rather than at garbage collection, and stop the source.
    cancel(reason) {
      impl.destroy()
      return reader.cancel(reason)
    },
  })
}

/**
 * Compresses a response body in place when it is worth compressing: a
 * compressible content type, a body over the size floor, no encoding
 * already applied, and a client that accepts gzip or brotli. Everything
 * else, most importantly text/event-stream, passes through untouched (SSE
 * must never be compressed or buffered).
 */
export async function maybeCompress(response: Response, acceptEncoding: string): Promise<Response> {
  if (!response.body) return response
  if (response.headers.has('content-encoding')) return response
  // A partial response's Content-Range counts bytes of the raw body.
  if (response.status === 206 || response.headers.has('content-range')) return response
  if (/\bno-transform\b/i.test(response.headers.get('cache-control') ?? '')) return response

  const contentType = response.headers.get('content-type') ?? ''
  if (!COMPRESSIBLE_TYPE_RE.test(contentType)) return response

  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) < MIN_COMPRESS_BYTES) return response

  const encoding = pickEncoding(acceptEncoding)
  if (!encoding) return response

  const compressedBody = compressBody(response.body, encoding)
  const headers = new Headers(response.headers)
  headers.set('content-encoding', encoding)
  headers.delete('content-length')
  // The encoded bytes are no longer byte-identical to what a strong ETag names.
  const etag = headers.get('etag')
  if (etag && !etag.startsWith('W/')) headers.set('etag', `W/${etag}`)
  appendVary(headers, 'Accept-Encoding')

  return new Response(compressedBody, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
