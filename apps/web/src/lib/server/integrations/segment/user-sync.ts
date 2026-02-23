/**
 * Segment CDP user-sync handler.
 *
 * Inbound:  Segment sends `identify` events via Source Functions or Webhook Destinations.
 *           Signature: HMAC-SHA1 of the raw body using the shared secret, base64-encoded,
 *           in the `x-signature` header.
 *
 * Outbound: Calls Segment's HTTP Tracking API to identify users with segment traits.
 *           Requires `writeKey` stored in integration secrets.
 *
 * Config fields (stored in integration.config):
 *   incomingSecret  — shared secret for verifying inbound webhook signatures
 *   outgoingEnabled — whether to push segment membership changes to Segment
 *
 * Secret fields (stored encrypted in integration.secrets):
 *   writeKey — Segment source write key for the HTTP Tracking API
 */

import { timingSafeEqual, createHmac } from 'crypto'
import type { UserSyncHandler, UserIdentifyPayload } from '../user-sync-types'

const SEGMENT_TRACKING_API = 'https://api.segment.io/v1'

/** Number of identify calls to fire in parallel per batch. */
const OUTBOUND_BATCH_SIZE = 10

export const segmentUserSync: UserSyncHandler = {
  async handleIdentify(request, body, config, _secrets): Promise<UserIdentifyPayload | Response> {
    // Verify HMAC-SHA1 signature if a shared secret is configured.
    // Segment signs the raw body with the source's shared secret.
    const incomingSecret = config.incomingSecret as string | undefined
    if (incomingSecret) {
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
    }

    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(body) as Record<string, unknown>
    } catch {
      return new Response('Invalid JSON body', { status: 400 })
    }

    // Only process identify events — acknowledge but ignore everything else
    if (payload.type !== 'identify') {
      return new Response('OK', { status: 200 })
    }

    const traits = (payload.traits as Record<string, unknown>) ?? {}

    // Email comes from traits (standard Segment field) or context.traits
    const contextTraits =
      ((payload.context as Record<string, unknown> | undefined)?.traits as
        | Record<string, unknown>
        | undefined) ?? {}
    const email = (traits.email ?? contextTraits.email) as string | undefined

    if (!email || typeof email !== 'string') {
      // No email — cannot map to a Quackback user; ack and move on
      return new Response('OK', { status: 200 })
    }

    return {
      email,
      externalUserId: payload.userId as string | undefined,
      traits: { ...contextTraits, ...traits },
    }
  },

  async syncSegmentMembership(users, segmentName, joined, config, secrets): Promise<void> {
    // Only push if outgoing is explicitly enabled
    if (!config.outgoingEnabled) return

    const writeKey = secrets.writeKey as string | undefined
    if (!writeKey || users.length === 0) return

    // Segment trait key: snake_case from segment name
    const traitKey = segmentName.toLowerCase().replace(/[^a-z0-9]+/g, '_')
    const encoded = Buffer.from(`${writeKey}:`).toString('base64')

    // Fire identify calls in parallel batches
    for (let i = 0; i < users.length; i += OUTBOUND_BATCH_SIZE) {
      const batch = users.slice(i, i + OUTBOUND_BATCH_SIZE)
      await Promise.allSettled(
        batch.map((u) =>
          fetch(`${SEGMENT_TRACKING_API}/identify`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${encoded}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              userId: u.externalUserId ?? u.email,
              traits: { [traitKey]: joined },
              // context.active: false tells Segment this is a server-side call
              context: { active: false },
            }),
          }).catch((err) => {
            console.error(`[Segment] Failed to sync user ${u.email}:`, err)
          })
        )
      )
    }
  },
}
