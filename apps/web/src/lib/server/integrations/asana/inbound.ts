/**
 * Asana inbound webhook handler.
 *
 * Receives webhook events from Asana.
 * Signature: HMAC-SHA256 in `X-Hook-Signature` header.
 * Handshake: Must echo `X-Hook-Secret` header on initial request.
 * Events are "compact" — must fetch the task via API to get status.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

const ASANA_API = 'https://app.asana.com/api/1.0'

export const asanaInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
    // Handshake: Asana sends X-Hook-Secret on initial webhook setup
    const hookSecret = request.headers.get('X-Hook-Secret')
    if (hookSecret) {
      return new Response('', {
        status: 200,
        headers: { 'X-Hook-Secret': hookSecret },
      })
    }

    const signature = request.headers.get('X-Hook-Signature')
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

  async parseStatusChange(
    body: string,
    config: Record<string, unknown>
  ): Promise<InboundWebhookResult | null> {
    const payload = JSON.parse(body)
    const events = payload.events
    if (!Array.isArray(events) || events.length === 0) return null

    // Find task change events (Asana sends compact events)
    const taskEvent = events.find(
      (e: { resource?: { resource_type?: string }; action?: string }) =>
        e.resource?.resource_type === 'task' && e.action === 'changed'
    )
    if (!taskEvent) return null

    const taskGid = taskEvent.resource?.gid
    if (!taskGid) return null

    // Asana compact events don't include the actual data — must fetch the task
    const accessToken = config.accessToken as string | undefined
    if (!accessToken) {
      console.error('[Asana Inbound] No access token in config for API fetch')
      return null
    }

    try {
      const response = await fetch(
        `${ASANA_API}/tasks/${taskGid}?opt_fields=memberships.section.name`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )

      if (!response.ok) {
        console.error(`[Asana Inbound] API fetch failed: ${response.status}`)
        return null
      }

      const task = (await response.json()) as {
        data?: {
          memberships?: Array<{ section?: { name?: string } }>
        }
      }

      // Asana uses sections as status — get the first section name
      const sectionName = task.data?.memberships?.[0]?.section?.name
      if (!sectionName) return null

      return {
        externalId: taskGid,
        externalStatus: sectionName,
        eventType: 'task.changed',
      }
    } catch (error) {
      console.error('[Asana Inbound] Failed to fetch task:', error)
      return null
    }
  },
}
