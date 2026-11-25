/**
 * Shortcut inbound webhook handler.
 *
 * Receives webhook events from Shortcut and extracts status changes.
 * Signature: HMAC-SHA256 hex in `Payload-Signature` header.
 * Status field: `changes.workflow_state_id.new` is a numeric ID, not a name.
 * The name is resolved from the payload's own `references` array, which
 * Shortcut populates with the workflow states involved in the change.
 *
 * The signed body carries no team, so the story is read back with the stored
 * token to confirm it belongs to the connected group (team) before the change
 * is applied automatically.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'
import { isoTimestamp } from '@/lib/server/integrations/inbound-time'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'shortcut' })

const SHORTCUT_API = 'https://api.app.shortcut.com/api/v3'

const EVENT_TYPE = 'story.workflow_state_changed'

interface ShortcutStoryScope {
  group_id?: string | null
  workflow_state_id?: number
}

export const shortcutInboundHandler: InboundWebhookHandler = {
  statusMode: 'automatic',
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
    config: Record<string, unknown>,
    secrets: Record<string, unknown>
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
    const { new: newStateId, old: oldStateId } = stateChange.changes.workflow_state_id as {
      new?: number
      old?: number
    }
    if (!storyId || !newStateId || newStateId === oldStateId) return null

    // Resolve the numeric state ID to its name via the payload's `references`
    // array. Shortcut includes the workflow states involved in the change, so
    // no separately-cached ID to name map is needed.
    const references = payload.references as
      Array<{ id?: number; entity_type?: string; name?: string }> | undefined
    const stateName = references?.find(
      (ref) => ref.entity_type === 'workflow-state' && ref.id === newStateId
    )?.name
    if (!stateName) {
      log.debug({ state_id: newStateId }, 'no workflow-state reference in webhook payload')
      return null
    }

    const externalId = String(storyId)
    const review = { externalId, externalStatus: stateName, eventType: EVENT_TYPE }
    const groupId = typeof config.channelId === 'string' ? config.channelId : null
    const token = typeof secrets.accessToken === 'string' ? secrets.accessToken : null
    if (!groupId || !token) return review

    const response = await integrationFetch(
      `${SHORTCUT_API}/stories/${encodeURIComponent(externalId)}`,
      { headers: { 'Shortcut-Token': token, 'Content-Type': 'application/json' } }
    )
    // Deleted stories no longer have a status. Other failures must retain the receipt for retry.
    if (response.status === 404) return null
    if (!response.ok)
      throw Object.assign(new Error('Could not read Shortcut story'), {
        status: response.status,
      })
    const story = (await response.json()) as ShortcutStoryScope

    // A story with no team cannot be matched to the connected one; a teammate reviews it.
    if (story.group_id == null) return review
    if (story.group_id !== groupId) return null
    // A later state change has its own event, so this one is stale.
    if (story.workflow_state_id !== newStateId) return null

    return {
      ...review,
      destinationId: groupId,
      occurredAt: isoTimestamp(payload.changed_at),
    }
  },
}
