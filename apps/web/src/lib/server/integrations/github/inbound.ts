/**
 * GitHub inbound webhook handler.
 *
 * Receives webhook events from GitHub and extracts issue status changes.
 * Signature: HMAC-SHA256 with `sha256=` prefix in `X-Hub-Signature-256` header.
 * Status: `action` field — `closed` or `reopened` on `issues` events.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

export const githubInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
    const signature = request.headers.get('X-Hub-Signature-256')
    if (!signature) {
      return new Response('Missing signature', { status: 401 })
    }

    const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    const valid =
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected))

    if (!valid) {
      return new Response('Invalid signature', { status: 401 })
    }

    return true
  },

  async parseStatusChange(body: string): Promise<InboundWebhookResult | null> {
    const payload = JSON.parse(body)

    // Only handle issue events with relevant actions
    if (payload.action !== 'closed' && payload.action !== 'reopened') {
      return null
    }

    if (!payload.issue?.number) return null

    // Map GitHub actions to status names
    const externalStatus = payload.action === 'closed' ? 'Closed' : 'Open'

    return {
      externalId: String(payload.issue.number),
      externalStatus,
      eventType: `issues.${payload.action}`,
    }
  },
}
