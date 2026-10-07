/**
 * RFC 8058 one-click unsubscribe: the `POST` a mail provider sends to the
 * `List-Unsubscribe` URL when the recipient presses its Unsubscribe button.
 *
 * The provider sends it on its own, with no cookies and no CSRF token, so the
 * token in the URL is the only credential, exactly as for the emailed link.
 * The answer is 200 whether the token was live, already spent, expired,
 * unknown or malformed: the outcome is the same (no further mail on that link)
 * and a uniform answer tells a prober nothing. A POST without the one-click
 * body is refused, so nothing but the RFC 8058 request ever acts here; a `GET`
 * of the same URL is the confirmation page and never writes.
 */
import { isUnsubscribeToken } from '@/lib/shared/unsubscribe-token'
import { logger } from '@/lib/server/logger'
import { processUnsubscribeToken } from '@/lib/server/domains/subscriptions/subscription.service'

const log = logger.child({ component: 'one-click-unsubscribe' })

/** Bodies here are one short form field; anything larger is not one. */
const MAX_BODY_BYTES = 1_024

/**
 * The body, read no further than the cap. A chunked request carries no
 * Content-Length to refuse up front, so the stream itself is cut off rather
 * than buffered whole. Null when the body is over the cap.
 */
async function readCappedBody(request: Request): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/** RFC 8058 allows the field as urlencoded or multipart form data. */
async function isOneClickBody(request: Request): Promise<boolean> {
  try {
    const body = await readCappedBody(request)
    if (!body) return false
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
      const form = await new Response(body, { headers: { 'content-type': contentType } }).formData()
      return form.get('List-Unsubscribe') === 'One-Click'
    }
    const text = new TextDecoder().decode(body)
    return new URLSearchParams(text).get('List-Unsubscribe') === 'One-Click'
  } catch {
    return false
  }
}

function plain(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function handleOneClickUnsubscribe(request: Request): Promise<Response> {
  if (!(await isOneClickBody(request))) {
    return plain(400, 'Expected List-Unsubscribe=One-Click')
  }

  const token = new URL(request.url).searchParams.get('token')
  if (!isUnsubscribeToken(token)) return plain(200, 'OK')

  try {
    const result = await processUnsubscribeToken(token)
    if (result) {
      log.info({ action: result.action }, 'one-click unsubscribe processed')
    } else {
      log.debug('one-click unsubscribe token invalid or expired')
    }
    return plain(200, 'OK')
  } catch (error) {
    // A real failure (the database, say) is not a spent link: answer so the
    // sender may try again rather than record an unsubscribe that did not happen.
    log.error({ err: error }, 'one-click unsubscribe failed')
    return plain(503, 'Try again later')
  }
}
