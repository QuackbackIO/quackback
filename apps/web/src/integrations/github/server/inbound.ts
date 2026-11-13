/**
 * GitHub inbound webhook handler.
 *
 * Receives webhook events from GitHub and extracts issue status changes.
 * Signature: HMAC-SHA256 with `sha256=` prefix in `X-Hub-Signature-256` header.
 * Status: `action` field — `closed` or `reopened` on `issues` events; a close
 * with `state_reason: not_planned` reports `Closed (not planned)`, which maps
 * like `Closed` until it has a mapping of its own.
 * Routing: each repository has its own webhook and secret; `destinationOf`
 * names the repository a delivery claims so the handler can pick that secret.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'

export const githubInboundHandler: InboundWebhookHandler = {
  statusMode: 'automatic',
  /** Every repository event carries the repository's name and its numeric id, which survives renames. */
  destinationOf(body: string) {
    let payload: { repository?: { full_name?: unknown; id?: unknown } }
    try {
      payload = JSON.parse(body) as typeof payload
    } catch {
      return null
    }
    const fullName = payload?.repository?.full_name
    if (typeof fullName !== 'string' || !fullName.includes('/')) return null
    const id = payload.repository?.id
    return {
      externalId: fullName,
      ...(typeof id === 'number' || typeof id === 'string' ? { externalKey: String(id) } : {}),
    }
  },
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
    let payload: {
      action?: string
      issue?: { number?: number; updated_at?: string; state_reason?: string | null }
      repository?: { full_name?: string }
    }
    try {
      payload = JSON.parse(body) as typeof payload
    } catch {
      return null
    }

    // Only handle issue events with relevant actions
    if (payload.action !== 'closed' && payload.action !== 'reopened') {
      return null
    }

    if (!payload.issue?.number) return null

    // Map GitHub actions to status names
    const notPlanned = payload.action === 'closed' && payload.issue.state_reason === 'not_planned'
    const externalStatus =
      payload.action === 'closed' ? (notPlanned ? 'Closed (not planned)' : 'Closed') : 'Open'

    return {
      destinationId: payload.repository?.full_name,
      occurredAt: payload.issue.updated_at,
      externalId: String(payload.issue.number),
      externalStatus,
      ...(notPlanned ? { fallbackStatus: 'Closed' } : {}),
      eventType: `issues.${payload.action}`,
      transition: payload.action,
    }
  },
}
