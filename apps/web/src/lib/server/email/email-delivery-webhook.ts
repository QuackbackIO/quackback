/**
 * SES SNS (or a signed JSON POST) for bounce/complaint events.
 * Resend delivery events also land on the inbound webhook after Svix verify.
 *
 * SNS cannot send Authorization. Subscribe the topic to this URL with
 * `?token=` equal to EMAIL_EVENTS_SIGNING_SECRET (or the inbound signing secret).
 * The token remains a required gate. When the body is an SNS envelope
 * (Notification / SubscriptionConfirmation / UnsubscribeConfirmation) the
 * Amazon signature is verified fail-closed as well.
 */
import { readTextBodyOr413 } from '@/lib/server/utils/read-body'
import { applyDeliveryEvent } from './email-delivery-events'
import {
  INVALID_SNS_SIGNATURE,
  isAmazonSnsHttpsUrl,
  isSnsEnvelope,
  verifySnsMessageSignature,
  type FetchSnsCert,
} from './sns-signature'
import { safeFetch } from '@/lib/server/content/ssrf-guard'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'email-delivery-webhook' })
const MAX_BODY = 256 * 1024

export type EmailDeliveryWebhookDeps = {
  fetchCert?: FetchSnsCert
  confirmSubscribeUrl?: (url: string) => Promise<void>
}

function configuredSecret(): string | null {
  const secret =
    process.env.EMAIL_EVENTS_SIGNING_SECRET ?? process.env.EMAIL_INBOUND_SIGNING_SECRET ?? ''
  return secret.length > 0 ? secret : null
}

function requestToken(request: Request): string | null {
  const bearer = request.headers.get('authorization')
  if (bearer?.toLowerCase().startsWith('bearer ')) return bearer.slice(7).trim()
  return new URL(request.url).searchParams.get('token')
}

async function defaultConfirmSubscribeUrl(url: string): Promise<void> {
  const res = await safeFetch(url, {
    method: 'GET',
    timeoutMs: 5_000,
    maxResponseBytes: 8 * 1024,
    onOverflow: 'error',
  })
  if (!res.ok) throw new Error('confirm failed')
}

function snsReject(): Response {
  return new Response(INVALID_SNS_SIGNATURE, { status: 401 })
}

export async function handleEmailDeliveryWebhook(
  request: Request,
  deps: EmailDeliveryWebhookDeps = {}
): Promise<Response> {
  const secret = configuredSecret()
  if (!secret) return new Response('Not found', { status: 404 })
  if (requestToken(request) !== secret) return new Response('Invalid signature', { status: 401 })

  const body = await readTextBodyOr413(request, MAX_BODY)
  if (body instanceof Response) return body

  let event: unknown
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  if (isSnsEnvelope(event)) {
    const verified = await verifySnsMessageSignature(event, { fetchCert: deps.fetchCert })
    if (!verified.ok) {
      log.warn({ reason: verified.reason }, 'rejected sns delivery event')
      if (verified.reason === 'cert_fetch_failed') {
        return new Response('Certificate fetch failed', { status: 502 })
      }
      return snsReject()
    }
  }

  if (isSnsEnvelope(event) && event.Type === 'SubscriptionConfirmation') {
    const url = event.SubscribeURL
    if (typeof url !== 'string' || !isAmazonSnsHttpsUrl(url)) return snsReject()
    try {
      await (deps.confirmSubscribeUrl ?? defaultConfirmSubscribeUrl)(url)
    } catch (err) {
      log.warn({ err }, 'sns subscription confirm failed')
      return new Response('Confirm failed', { status: 502 })
    }
    return Response.json({ status: 'subscribed' })
  }

  try {
    const recorded = await applyDeliveryEvent(event)
    return Response.json({ status: recorded ? 'recorded' : 'ignored' })
  } catch (err) {
    log.error({ err }, 'email delivery webhook failed')
    return new Response('Failed', { status: 500 })
  }
}
