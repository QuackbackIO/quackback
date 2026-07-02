/**
 * GitHub inbound webhook handler.
 *
 * Receives webhook events from GitHub and extracts issue status changes.
 * Signature: HMAC-SHA256 with `sha256=` prefix in `X-Hub-Signature-256` header.
 * Status: `action` field — `closed` or `reopened` on `issues` events.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

/**
 * Verify a GitHub webhook HMAC-SHA256 signature.
 * Exported so the multi-integration orchestrator can call it directly.
 */
export function verifyGitHubSignature(
  signatureHeader: string | null,
  body: string,
  secret: string
): boolean {
  if (!signatureHeader) return false
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  return (
    signatureHeader.length === expected.length &&
    timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected))
  )
}

export const githubInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
    const signature = request.headers.get('X-Hub-Signature-256')
    if (!verifyGitHubSignature(signature, body, secret)) {
      return new Response(signature ? 'Invalid signature' : 'Missing signature', { status: 401 })
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
