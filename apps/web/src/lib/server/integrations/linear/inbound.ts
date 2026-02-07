/**
 * Linear inbound webhook handler.
 *
 * Receives webhook events from Linear and extracts status changes.
 * Signature: HMAC-SHA256 hex in `Linear-Signature` header.
 * Status field: `data.state.name` (only when `updatedFrom.stateId` is present).
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

export const linearInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
    const signature = request.headers.get('Linear-Signature')
    if (!signature) {
      return new Response('Missing signature', { status: 401 })
    }

    const expected = createHmac('sha256', secret).update(body).digest('hex')
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

    // Only handle Issue updates
    if (payload.type !== 'Issue' || payload.action !== 'update') {
      return null
    }

    // Only handle state changes (updatedFrom contains previous stateId)
    if (!payload.updatedFrom?.stateId) {
      return null
    }

    const stateName = payload.data?.state?.name
    if (!stateName) return null

    return {
      externalId: payload.data.id,
      externalStatus: stateName,
      eventType: 'issue.state_changed',
    }
  },
}
