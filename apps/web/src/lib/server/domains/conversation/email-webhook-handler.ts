/**
 * Inbound email webhook handler (POST /api/chat/email/inbound). The trust
 * boundary for the email channel: when inbound is unconfigured the route 404s
 * as if it didn't exist; otherwise every request is Svix-signature-verified
 * before its `email.received` payload is routed into ingestion. Other event
 * types and unroutable payloads are acked (200) so the provider stops retrying.
 */
import { isEmailInboundConfigured } from './conversation.email-channel'
import { verifyResendWebhookSignature } from './email-webhook-verify'
import { ingestInboundEmail } from './conversation.email-inbound.service'
import { readTextBodyOr413 } from '@/lib/server/utils/read-body'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'conversation-email-inbound' })

// Resend inbound events can embed base64 attachment payloads, so allow up to 10 MB.
export const MAX_EMAIL_WEBHOOK_BODY_BYTES = 10 * 1024 * 1024

/** Svix sends both `webhook-*` and `svix-*` aliases; accept either. */
function header(request: Request, base: string): string | null {
  return request.headers.get(`webhook-${base}`) ?? request.headers.get(`svix-${base}`)
}

export async function handleInboundEmailWebhook(request: Request): Promise<Response> {
  if (!isEmailInboundConfigured()) return new Response('Not found', { status: 404 })

  // Bounded read of the raw body; the signature covers these exact bytes.
  const body = await readTextBodyOr413(request, MAX_EMAIL_WEBHOOK_BODY_BYTES)
  if (body instanceof Response) return body
  const verified = verifyResendWebhookSignature({
    id: header(request, 'id'),
    timestamp: header(request, 'timestamp'),
    signature: header(request, 'signature'),
    body,
    secret: process.env.EMAIL_INBOUND_SIGNING_SECRET ?? '',
  })
  if (!verified) return new Response('Invalid signature', { status: 401 })

  let event: unknown
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const type = (event as { type?: unknown })?.type
  // Only inbound receipts are actionable; ack the rest so retries stop.
  if (typeof type === 'string' && type !== 'email.received') {
    return new Response('', { status: 200 })
  }

  // Conversations gate: when no visitor surface (widget messenger or portal
  // Support) is enabled, replies have nowhere to land. Ack-and-drop like any
  // other unroutable payload so the provider stops retrying.
  const { isConversationsEnabled } = await import('@/lib/server/domains/settings/settings.support')
  if (!(await isConversationsEnabled())) {
    log.warn({ reason: 'conversations_disabled' }, 'dropped inbound email event')
    return Response.json({ status: 'disabled' })
  }

  try {
    const result = await ingestInboundEmail(event)
    if (
      result.status === 'no_conversation' ||
      result.status === 'no_ticket' ||
      result.status === 'empty' ||
      result.status === 'from_mismatch' ||
      result.status === 'rate_limited'
    ) {
      log.warn({ status: result.status }, 'dropped inbound email event')
    }
    return Response.json({ status: result.status })
  } catch (err) {
    // A transient failure should be retried; idempotency makes redelivery safe.
    log.error({ err }, 'inbound email ingest failed')
    return new Response('Ingest failed', { status: 500 })
  }
}
