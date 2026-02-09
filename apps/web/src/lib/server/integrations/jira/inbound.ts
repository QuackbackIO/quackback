/**
 * Jira inbound webhook handler.
 *
 * Receives webhook events from Jira and extracts status changes.
 * Signature: HMAC-SHA256 in `X-Hub-Signature` header (optional, Jira Cloud).
 * Status field: `changelog.items[]` where `field === 'status'` → `toString`.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

export const jiraInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
    const rawSignature = request.headers.get('X-Hub-Signature')
    if (!rawSignature) {
      // Jira Cloud webhooks may not always have HMAC — but if we configured a secret, require it
      return new Response('Missing signature', { status: 401 })
    }

    // Jira sends the signature as "sha256=<hex>" — strip the prefix for comparison
    const signature = rawSignature.startsWith('sha256=')
      ? rawSignature.slice('sha256='.length)
      : rawSignature

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

    // Jira sends `jira:issue_updated` for issue changes
    if (
      !payload.webhookEvent?.includes('issue_updated') &&
      payload.webhookEvent !== 'jira:issue_updated'
    ) {
      return null
    }

    // Look for a status change in the changelog
    const statusChange = payload.changelog?.items?.find(
      (item: { field: string }) => item.field === 'status'
    )
    if (!statusChange) return null

    const issueKey = payload.issue?.key
    if (!issueKey) return null

    return {
      externalId: issueKey,
      externalStatus: statusChange.toString,
      eventType: 'jira:issue_updated',
    }
  },
}
