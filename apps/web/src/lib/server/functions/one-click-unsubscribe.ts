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

async function isOneClickBody(request: Request): Promise<boolean> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return false
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
      const form = await request.formData()
      return form.get('List-Unsubscribe') === 'One-Click'
    }
    const body = await request.text()
    if (body.length > MAX_BODY_BYTES) return false
    return new URLSearchParams(body).get('List-Unsubscribe') === 'One-Click'
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
