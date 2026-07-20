/**
 * Segment CDP user-sync handler.
 *
 * Inbound:  Segment sends `identify` events via Source Functions or Webhook Destinations.
 *           Signature: HMAC-SHA1 of the raw body using the shared secret, base64-encoded,
 *           in the `x-signature` header.
 *
 * Outbound: Calls Segment's HTTP Tracking API to identify users with segment attributes.
 *           Requires `writeKey` stored in integration secrets.
 *
 * Config fields (stored in integration.config):
 *   incomingSecret  — shared secret for verifying inbound webhook signatures
 *   outgoingEnabled — whether to push segment membership changes to Segment
 *
 * Secret fields (stored encrypted in integration.secrets):
 *   writeKey — Segment source write key for the HTTP Tracking API
 */

import { timingSafeEqual, createHmac, createHash } from 'crypto'
import type {
  UserSyncHandler,
  UserIdentifyPayload,
} from '@/lib/server/integrations/user-sync-types'
import { logger } from '@/lib/server/logger'
import { db, integrations, and, eq } from '@/lib/server/db'
import { decryptSecrets } from '@/lib/server/integrations/encryption'
import { getRedis } from '@/lib/server/redis'

const log = logger.child({ component: 'segment' })

const SEGMENT_TRACKING_API = 'https://api.segment.io/v1'

/** Number of identify calls to fire in parallel per batch. */
const OUTBOUND_BATCH_SIZE = 10
const MAX_ERROR_BODY_LENGTH = 300

export async function warnIfSegmentInboundIsInsecure(): Promise<void> {
  const integration = await db.query.integrations.findFirst({
    where: and(eq(integrations.integrationType, 'segment'), eq(integrations.status, 'active')),
    columns: { secrets: true },
  })
  if (!integration) return
  const secrets = integration.secrets ? decryptSecrets(integration.secrets) : {}
  if (!secrets.incomingSecret) {
    log.error('active Segment integration has no inbound secret; identify ingestion is disabled')
  }
}

export const segmentUserSync: UserSyncHandler = {
  async handleIdentify(request, body, _config, secrets): Promise<UserIdentifyPayload | Response> {
    // Fail closed: active Segment ingestion is disabled until an encrypted
    // inbound secret has been provisioned through the settings flow.
    // Segment signs the raw body with the source's shared secret.
    const incomingSecret = secrets.incomingSecret as string | undefined
    if (!incomingSecret) {
      log.error('inbound Segment sync disabled: incoming secret is not configured')
      return new Response('Segment inbound secret not configured', { status: 403 })
    }
    const signature = request.headers.get('x-signature')
    if (!signature) {
      return new Response('Missing x-signature header', { status: 401 })
    }

    const expected = createHmac('sha1', incomingSecret).update(body).digest('base64')
    try {
      const sigBuf = Buffer.from(signature, 'base64')
      const expBuf = Buffer.from(expected, 'base64')
      if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        return new Response('Invalid signature', { status: 401 })
      }
    } catch {
      return new Response('Invalid signature', { status: 401 })
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(body) as Record<string, unknown>
    } catch {
      return new Response('Invalid JSON body', { status: 400 })
    }

    // Segment includes messageId on normal deliveries. Claim it before the
    // write so provider retries cannot apply the same identify mutation twice.
    if (typeof payload.messageId === 'string' && payload.messageId.length > 0) {
      const digest = createHash('sha256').update(payload.messageId).digest('hex')
      const claimed = await getRedis().set(`segment:identify:${digest}`, '1', 'EX', 86_400, 'NX')
      if (claimed !== 'OK') return new Response('OK', { status: 200 })
    }

    // Only process identify events — acknowledge but ignore everything else
    if (payload.type !== 'identify') {
      return new Response('OK', { status: 200 })
    }

    const traits = (payload.traits ?? {}) as Record<string, unknown>
    const context = (payload.context ?? {}) as Record<string, unknown>
    const contextTraits = (context.traits ?? {}) as Record<string, unknown>
    const email = (traits.email ?? contextTraits.email) as string | undefined

    if (typeof email !== 'string' || !email) {
      return new Response('OK', { status: 200 })
    }

    return {
      email,
      externalUserId: payload.userId as string | undefined,
      attributes: { ...contextTraits, ...traits },
    }
  },

  async syncSegmentMembership(users, segmentName, joined, config, secrets): Promise<void> {
    // Only push if outgoing is explicitly enabled
    if (!config.outgoingEnabled) return

    const writeKey = secrets.writeKey as string | undefined
    if (!writeKey || users.length === 0) return

    // Segment attribute key: snake_case from segment name
    const attributeKey = segmentName.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    const encoded = Buffer.from(`${writeKey}:`).toString('base64')
    let totalFailures = 0

    for (let i = 0; i < users.length; i += OUTBOUND_BATCH_SIZE) {
      const batch = users.slice(i, i + OUTBOUND_BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (u) => {
          const response = await fetch(`${SEGMENT_TRACKING_API}/identify`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${encoded}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: u.externalUserId ?? u.email,
              traits: { [attributeKey]: joined },
              context: { active: false },
            }),
          })

          if (!response.ok) {
            const errorBody = await response
              .text()
              .then((text) => text.trim().slice(0, MAX_ERROR_BODY_LENGTH))
              .catch(() => '')
            const detail = errorBody ? `: ${errorBody}` : ''
            throw new Error(`HTTP ${response.status} ${response.statusText}${detail}`)
          }
        })
      )

      let batchFailures = 0
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        if (r.status === 'rejected') {
          batchFailures++
          log.error({ err: r.reason }, 'failed to sync user')
        }
      }
      totalFailures += batchFailures
    }

    if (totalFailures > 0) {
      throw new Error(
        `[Segment] Failed to sync ${totalFailures}/${users.length} users for segment "${segmentName}"`
      )
    }
  },
}
