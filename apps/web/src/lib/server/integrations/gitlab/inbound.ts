/**
 * GitLab inbound webhook handler.
 * Receives issue state change events for two-way status sync.
 */

import { timingSafeEqual } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

export const gitlabInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, _body: string, secret: string): Promise<true | Response> {
    // GitLab uses a shared secret token in the X-Gitlab-Token header
    const token = request.headers.get('X-Gitlab-Token')
    if (!token) {
      return new Response('Missing token', { status: 401 })
    }

    const expected = Buffer.from(secret)
    const actual = Buffer.from(token)

    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return new Response('Invalid token', { status: 401 })
    }

    return true
  },

  async parseStatusChange(body: string): Promise<InboundWebhookResult | null> {
    const payload = JSON.parse(body) as {
      object_kind?: string
      object_attributes?: {
        iid?: number
        action?: string
        state?: string
      }
    }

    if (payload.object_kind !== 'issue') return null
    if (!payload.object_attributes?.iid) return null

    const { action, state, iid } = payload.object_attributes
    if (action !== 'update' && action !== 'close' && action !== 'reopen') return null
    if (!state) return null

    // Map GitLab states: opened, closed
    const statusMap: Record<string, string> = {
      opened: 'Open',
      closed: 'Closed',
    }

    const externalStatus = statusMap[state]
    if (!externalStatus) return null

    return {
      externalId: String(iid),
      externalStatus,
      eventType: 'issue.state_changed',
    }
  },
}
