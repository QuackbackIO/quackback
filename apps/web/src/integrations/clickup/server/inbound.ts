/**
 * ClickUp inbound webhook handler.
 *
 * Receives webhook events from ClickUp and extracts status changes.
 * Signature: HMAC-SHA256 of the body in the `X-Signature` header.
 * A signed `taskStatusUpdated` event with a status history item is the trigger.
 * The task is then read back with the stored token: its list must be the
 * configured list, and its current status is the one applied.
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type {
  InboundWebhookHandler,
  InboundWebhookResult,
} from '@/lib/server/integrations/inbound-types'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'

const CLICKUP_API = 'https://api.clickup.com/api/v2'

interface ClickUpTask {
  status?: { status?: unknown }
  list?: { id?: unknown }
  date_updated?: unknown
}

/** ClickUp timestamps are Unix milliseconds, sent as a string or a number. */
function isoFromMillis(value: unknown): string | undefined {
  const millis = typeof value === 'string' && value.trim() ? Number(value) : value
  if (typeof millis !== 'number' || millis <= 0) return undefined
  const date = new Date(millis)
  // An out-of-range time would make toISOString throw and retry the receipt forever.
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/** Returns null for a deleted task; other failures throw so the receipt retries. */
async function readTask(taskId: string, accessToken: string): Promise<ClickUpTask | null> {
  const response = await integrationFetch(`${CLICKUP_API}/task/${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (response.status === 404) return null
  if (!response.ok)
    throw Object.assign(new Error('Could not read ClickUp task status'), {
      status: response.status,
    })
  return (await response.json()) as ClickUpTask
}

export const clickupInboundHandler: InboundWebhookHandler = {
  statusMode: 'automatic',
  async verifySignature(request: Request, body: string, secret: string): Promise<true | Response> {
    const signature = request.headers.get('X-Signature')
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

    if (payload.event !== 'taskStatusUpdated') {
      return null
    }

    const taskId = payload.task_id
    if (!taskId) return null

    // Only a status history item proves the status changed.
    const statusItem = Array.isArray(payload.history_items)
      ? payload.history_items.find((item: { field?: unknown }) => item?.field === 'status')
      : undefined
    const newStatus = statusItem?.after?.status
    if (!newStatus) return null

    const externalId = String(taskId)
    const listId = typeof config.channelId === 'string' ? config.channelId : ''
    const accessToken = typeof secrets.accessToken === 'string' ? secrets.accessToken : ''
    if (!listId || !accessToken) {
      return { externalId, externalStatus: newStatus, eventType: 'taskStatusUpdated' }
    }

    // The history item's parent_id is not reliably the list, so scope comes from the read-back.
    const task = await readTask(externalId, accessToken)
    if (!task || task.list?.id !== listId) return null
    const status = task.status?.status
    if (typeof status !== 'string' || !status) return null

    return {
      externalId,
      externalStatus: status,
      eventType: 'taskStatusUpdated',
      destinationId: listId,
      occurredAt: isoFromMillis(statusItem.date) ?? isoFromMillis(task.date_updated),
    }
  },
}
