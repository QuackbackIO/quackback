/**
 * Bounded request-body readers. Endpoints that buffer a raw body before any
 * auth or signature check (webhook receivers, proxy uploads) must cap how
 * much they read so an unauthenticated client cannot exhaust memory.
 */

// Compact JSON webhook payloads (issue trackers, Slack events/interactions);
// 1 MB is generous headroom. Handlers with bigger payloads own their own cap.
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024

/**
 * Cheap Content-Length pre-check: true when the declared length exceeds
 * maxBytes. A missing header (Number(null) is 0) or a garbage value (NaN) is
 * not conclusive, so both return false and the caller's streaming or
 * post-parse backstop stays authoritative.
 */
export function contentLengthExceeds(request: Request, maxBytes: number): boolean {
  const declaredLength = Number(request.headers.get('content-length'))
  return Number.isFinite(declaredLength) && declaredLength > maxBytes
}

// Reads up to maxBytes from the request body stream, cancelling early if exceeded.
// Returns null when the body exceeds the limit, avoiding full buffering of oversized payloads.
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | null> {
  // A declared Content-Length over the limit never needs reading. The stream
  // loop below still enforces the cap when the header is absent or wrong.
  if (contentLengthExceeds(request, maxBytes)) return null

  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array(0)

  const chunks: Uint8Array[] = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

// Text variant for handlers that verify signatures over the raw string body.
export async function readTextBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  const body = await readBodyWithLimit(request, maxBytes)
  return body === null ? null : new TextDecoder().decode(body)
}

/**
 * Text variant that maps an over-limit body straight to a 413 Response, for
 * webhook handlers that all share the same rejection shape. Callers guard
 * with `if (body instanceof Response) return body`.
 */
export async function readTextBodyOr413(
  request: Request,
  maxBytes: number
): Promise<string | Response> {
  const body = await readTextBodyWithLimit(request, maxBytes)
  return body === null ? new Response('Payload too large', { status: 413 }) : body
}
