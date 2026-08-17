/**
 * SES SNS (or a signed JSON POST) for bounce/complaint events.
 * Resend delivery events also land on the inbound webhook after Svix verify.
 */
import { readTextBodyOr413 } from '@/lib/server/utils/read-body'
import { applyDeliveryEvent } from './email-delivery-events'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'email-delivery-webhook' })
const MAX_BODY = 256 * 1024

function configuredSecret(): string | null {
  const secret =
    process.env.EMAIL_EVENTS_SIGNING_SECRET ?? process.env.EMAIL_INBOUND_SIGNING_SECRET ?? ''
  return secret.length > 0 ? secret : null
}

export async function handleEmailDeliveryWebhook(request: Request): Promise<Response> {
  const secret = configuredSecret()
  if (!secret) return new Response('Not found', { status: 404 })

  const bearer = request.headers.get('authorization')
  const token = bearer?.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : null
  if (token !== secret) return new Response('Invalid signature', { status: 401 })

  const body = await readTextBodyOr413(request, MAX_BODY)
  if (body instanceof Response) return body

  let event: unknown
  try {
    event = JSON.parse(body)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  try {
    const recorded = await applyDeliveryEvent(event)
    return Response.json({ status: recorded ? 'recorded' : 'ignored' })
  } catch (err) {
    log.error({ err }, 'email delivery webhook failed')
    return new Response('Failed', { status: 500 })
  }
}
