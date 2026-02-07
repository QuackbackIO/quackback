/**
 * ClickUp inbound webhook handler.
 *
 * Receives webhook events from ClickUp and extracts status changes.
 * Signature: HMAC-SHA256 in `X-Signature` header.
 * Status field: `history_items[].after.status` for `taskStatusUpdated` events.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

export const clickupInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
    const signature = request.headers.get('X-Signature')
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

    if (payload.event !== 'taskStatusUpdated') {
      return null
    }

    const taskId = payload.task_id
    if (!taskId) return null

    // Extract the new status from history items
    const statusItem = payload.history_items?.find(
      (item: { field: string }) => item.field === 'status'
    )
    const newStatus = statusItem?.after?.status
    if (!newStatus) return null

    return {
      externalId: taskId,
      externalStatus: newStatus,
      eventType: 'taskStatusUpdated',
    }
  },
}
