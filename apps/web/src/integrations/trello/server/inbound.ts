/**
 * Trello inbound webhook handler.
 *
 * Receives card movement events for two-way status sync. The body is signed, but
 * the event is still only a trigger: the card is read back with the stored
 * credentials so the status and board come from Trello's current state. Scope is
 * checked by board, because a status change moves the card out of the configured
 * list.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'
import { getTrelloCardList, type TrelloCardList } from '@/integrations/trello/server/boards'

function isoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

export const trelloInboundHandler: InboundWebhookHandler = {
  statusMode: 'automatic',
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

  async parseStatusChange(
    body: string,
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<InboundWebhookResult | null> {
    const payload = JSON.parse(body) as {
      action?: {
        type: string
        date?: string
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

    const externalId = payload.action.data.card.id
    const channelId = nonEmptyString(config.channelId)
    const boardId = nonEmptyString(config.boardId)
    const apiKey = nonEmptyString(config.apiKey)
    const token = nonEmptyString(secrets.accessToken)
    if (!channelId || !boardId || !apiKey || !token) {
      return {
        externalId,
        externalStatus: payload.action.data.listAfter.name,
        eventType: 'card.moved',
      }
    }

    let card: TrelloCardList
    try {
      card = await getTrelloCardList(apiKey, token, externalId)
    } catch (error) {
      // A deleted card has no status to apply. Other failures retain the receipt for retry.
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
    if (card.boardId !== boardId || !card.listName) return null

    return {
      externalId,
      externalStatus: card.listName,
      eventType: 'card.moved',
      destinationId: channelId,
      occurredAt: isoDate(payload.action.date),
    }
  },
}
