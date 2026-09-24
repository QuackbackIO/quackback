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
 */
import { createMiddleware } from '@tanstack/react-start'

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

/** Text (never event streams), JSON and XML, including their structured
 *  suffix types such as application/rss+xml and application/ld+json, and SVG. */
const COMPRESSIBLE_TYPE_RE =
  /^(text\/(?!event-stream)|application\/(json|javascript|xml|[\w.-]+\+(json|xml))\b|image\/svg\+xml)/i

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
 * insensitively deduped, preserving first-seen order. A route can carry a
 * Vary on the Response object it returns (e.g. publicWorkspaceCacheHeaders'
 * Host) and/or on the framework's own H3 event (e.g. bootstrap.ts's cache
 * Vary, set via setResponseHeader) -- either, both, or neither may be
 * present, and whichever this module writes to has to reflect all of them
 * or it silently drops one.
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
 * A TransformStream that pipes bytes through node:zlib and forces a flush
 * after every input chunk, so the compressed output tracks the input's
 * arrival instead of waiting for the whole stream to close.
 *
 * Completion of the final flush is signalled by the zlib stream's own
 * 'end' event, not by the .end() callback: that callback fires once the
 * writable side is done, but zlib can still have one more buffered 'data'
 * event in flight at that point, and enqueueing it after the
 * TransformStream controller has closed throws. 'end' is only emitted
 * once every 'data' event has already been delivered.
 */
async function createStreamingCompressor(
  encoding: Encoding
): Promise<TransformStream<Uint8Array, Uint8Array>> {
  // Dynamic import: this module is reachable from the client bundle via
  // start.ts's isomorphic config. node: specifiers are externalized rather
  // than rejected at build time (vite.config.ts), so a static import here
  // would still ship a bare `import ... from "node:zlib"` in the browser
  // bundle -- and since compression.ts sits in the eager entry graph, the
  // browser actually tries to fetch it, a guaranteed 404 on every page
  // load. createStreamingCompressor only ever runs inside
  // compressionMiddleware's server() callback, so this never executes
  // client-side.
  const zlib = await import('node:zlib')
  const impl =
    encoding === 'br'
      ? zlib.createBrotliCompress({
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: DYNAMIC_BROTLI_QUALITY },
        })
      : zlib.createGzip()
  const flushOp =
    encoding === 'br' ? zlib.constants.BROTLI_OPERATION_FLUSH : zlib.constants.Z_PARTIAL_FLUSH

  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      impl.on('data', (chunk: Buffer) =>
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength))
      )
      impl.on('error', (err) => controller.error(err))
    },
    transform(chunk) {
      return new Promise<void>((resolve, reject) => {
        impl.write(chunk, (err) => {
          if (err) {
            reject(err)
            return
          }
          impl.flush(flushOp, () => resolve())
        })
      })
    },
    flush() {
      return new Promise<void>((resolve, reject) => {
        impl.once('end', () => resolve())
        impl.once('error', reject)
        impl.end()
      })
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
  if (!encoding) {
    // Served as is to this client, but compressed to one that accepts it, so a
    // cache must not hand this copy to the next client either.
    const headers = new Headers(response.headers)
    appendVary(headers, 'Accept-Encoding')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  const compressedBody = response.body.pipeThrough(await createStreamingCompressor(encoding))
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

/**
 * Minimal shape of what the framework's next() resolves to; see
 * request-context.ts's identical NextResult for why response is optional.
 */
interface NextResult {
  response?: Response
}

/**
 * Core compression step, decoupled from the framework middleware wrapper so
 * it stays generic over whatever next() actually resolves to (the real
 * RequestServerResult, not just the response field this module cares
 * about) and mutates that same object in place, the way
 * request-context.ts's handleRequestWithContext does.
 */
export async function compressResultResponse<T extends NextResult>(opts: {
  request: Request
  next: () => Promise<T>
}): Promise<T> {
  const result = await opts.next()
  if (result.response) {
    const compressed = await maybeCompress(
      result.response,
      opts.request.headers.get('accept-encoding') ?? ''
    )
    if (compressed !== result.response) {
      result.response = compressed
      // Dynamic import: this file is reachable from the client bundle via
      // start.ts's isomorphic config, and @tanstack/react-start/server is a
      // protected server-only specifier there (see bootstrap.ts for the
      // same pattern). compressionMiddleware itself only ever runs inside
      // createMiddleware().server(), so this import never actually
      // executes on the client.
      const { getResponseHeader, setResponseHeader } = await import('@tanstack/react-start/server')
      // Once anything is written to the H3 event's own Vary (e.g.
      // bootstrap.ts's cache Vary, via setResponseHeader) it wins outright
      // over whatever the Response object carries when the final response
      // is assembled -- so this has to fold in whichever of the two, or
      // both, already held a value before writing the merged result back.
      const merged = mergeVaryValues(
        getResponseHeader('vary') ?? '',
        compressed.headers.get('vary') ?? ''
      )
      if (merged) setResponseHeader('vary', merged)
    }
  }
  return result
}

/**
 * Outermost request middleware: wraps the fully-formed response (every
 * other middleware has already applied its headers) and compresses its
 * body when the client accepts it. Placed first in the requestMiddleware
 * array in start.ts so it sees the truly final bytes, including whatever
 * request-context or CSRF already added to the headers.
 */
export const compressionMiddleware = createMiddleware().server(({ next, request }) =>
  compressResultResponse({ request, next: () => Promise.resolve(next()) })
)
