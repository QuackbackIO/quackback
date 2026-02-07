/**
 * Shortcut inbound webhook handler.
 *
 * Receives webhook events from Shortcut and extracts status changes.
 * Signature: HMAC-SHA256 hex in `Payload-Signature` header.
 * Status field: `changes.workflow_state_id.new` — this is an ID, not a name.
 * Must map workflow state IDs to names using config.workflowStates.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'

export const shortcutInboundHandler: InboundWebhookHandler = {
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
    const signature = request.headers.get('Payload-Signature')
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
    const actions = payload.actions
    if (!Array.isArray(actions)) return null

    // Look for story updates with workflow_state_id changes
    const stateChange = actions.find(
      (a: { entity_type?: string; action?: string; changes?: Record<string, unknown> }) =>
        a.entity_type === 'story' && a.action === 'update' && a.changes?.workflow_state_id
    )
    if (!stateChange) return null

    const storyId = stateChange.id
    const newStateId = (stateChange.changes.workflow_state_id as { new?: number })?.new
    if (!storyId || !newStateId) return null

    // Map workflow state ID to name using cached config
    const workflowStates = config.workflowStates as Record<string, string> | undefined
    const stateName = workflowStates?.[String(newStateId)]
    if (!stateName) {
      console.log(
        `[Shortcut Inbound] Unknown workflow state ID: ${newStateId}. Configure workflowStates mapping.`
      )
      return null
    }

    return {
      externalId: String(storyId),
      externalStatus: stateName,
      eventType: 'story.workflow_state_changed',
    }
  },
}
