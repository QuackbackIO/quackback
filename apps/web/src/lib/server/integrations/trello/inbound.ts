/**
 * Trello inbound webhook handler.
 * Receives card movement events for two-way status sync.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

export const trelloInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
    // Trello HEAD request for webhook verification
    if (request.method === 'HEAD') {
      return new Response('OK', { status: 200 })
    }

    const callbackUrl = request.url
    const hash = createHmac('sha1', secret)
      .update(body + callbackUrl)
      .digest('base64')

    const signature = request.headers.get('x-trello-webhook')
    if (!signature) {
      return new Response('Missing signature', { status: 401 })
    }

    const expected = Buffer.from(hash)
    const actual = Buffer.from(signature)

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return new Response('Invalid signature', { status: 401 })
    }

    return true
  },

  async parseStatusChange(body: string): Promise<InboundWebhookResult | null> {
    const payload = JSON.parse(body) as {
      action?: {
        type: string
        data?: {
          card?: { id: string }
          listAfter?: { name: string }
          listBefore?: { name: string }
        }
      }
    }

    // Only handle card movement between lists
    if (payload.action?.type !== 'updateCard') return null
    if (!payload.action.data?.listAfter || !payload.action.data?.listBefore) return null
    if (!payload.action.data.card?.id) return null

    return {
      externalId: payload.action.data.card.id,
      externalStatus: payload.action.data.listAfter.name,
      eventType: 'card.moved',
    }
  },
}
