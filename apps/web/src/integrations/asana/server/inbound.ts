/**
 * Asana inbound webhook handler.
 *
 * Receives webhook events from Asana.
 * Signature: HMAC-SHA256 in `X-Hook-Signature` header.
 * Handshake: Must echo `X-Hook-Secret` header on initial request.
 * Events are "compact" — must fetch the task via API to get status.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'

const ASANA_API = 'https://app.asana.com/api/1.0'

export const asanaInboundHandler: InboundWebhookHandler = {
  statusMode: 'review',
  handshake(request) {
    const secret = request.headers.get('X-Hook-Secret')
    // The authenticated registration response supplies the trusted signing secret.
    // Echoing a challenge must never overwrite an existing subscription's secret.
    return secret ? new Response('', { status: 200, headers: { 'X-Hook-Secret': secret } }) : null
  },
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
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
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
  ): Promise<InboundWebhookResult[]> {
    const payload = JSON.parse(body)
    if (!Array.isArray(payload.events)) return []
    const tasks = new Set<string>()
    for (const event of payload.events) {
      if (
        event.resource?.resource_type === 'task' &&
        event.action === 'changed' &&
        typeof event.resource.gid === 'string'
      )
        tasks.add(event.resource.gid)
    }
    const results: InboundWebhookResult[] = []
    for (const taskGid of tasks) {
      const response = await integrationFetch(
        `${ASANA_API}/tasks/${encodeURIComponent(taskGid)}?opt_fields=memberships.project.gid,memberships.section.name`,
        { headers: { Authorization: `Bearer ${secrets.accessToken}` } }
      )
      // Deleted tasks no longer have a status. Other failures must retain the receipt for retry.
      if (response.status === 404) continue
      if (!response.ok)
        throw Object.assign(new Error('Could not read Asana task status'), {
          status: response.status,
        })
      const task = (await response.json()) as {
        data?: { memberships?: Array<{ project?: { gid?: string }; section?: { name?: string } }> }
      }
      const membership = task.data?.memberships?.find(
        (member) => member.project?.gid === config.channelId
      )
      if (!membership?.section?.name) continue
      results.push({
        externalId: taskGid,
        externalStatus: membership.section.name,
        destinationId: membership.project!.gid,
        eventType: 'task.changed',
      })
    }
    return results
  },
}
