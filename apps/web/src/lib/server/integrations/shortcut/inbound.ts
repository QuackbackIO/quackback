/**
 * Shortcut inbound webhook handler.
 *
 * Receives webhook events from Shortcut and extracts status changes.
 * Signature: HMAC-SHA256 hex in `Payload-Signature` header.
 * Status field: `changes.workflow_state_id.new` — this is a numeric ID, not a
 * name. The name is resolved from the payload's own `references` array, which
 * Shortcut populates with the workflow states involved in the change.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type { InboundWebhookHandler, InboundWebhookResult } from '../inbound-types'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'shortcut' })

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

  async parseStatusChange(body: string): Promise<InboundWebhookResult | null> {
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

    // Resolve the numeric state ID to its name via the payload's `references`
    // array — Shortcut includes the workflow states involved in the change, so
    // no separately-cached ID→name map is needed.
    const references = payload.references as
      | Array<{ id?: number; entity_type?: string; name?: string }>
      | undefined
    const stateName = references?.find(
      (ref) => ref.entity_type === 'workflow-state' && ref.id === newStateId
    )?.name
    if (!stateName) {
      log.debug({ state_id: newStateId }, 'no workflow-state reference in webhook payload')
      return null
    }

    return {
      externalId: String(storyId),
      externalStatus: stateName,
      eventType: 'story.workflow_state_changed',
    }
  },
}
