import crypto from 'crypto'
import type { CFWebhookPayload } from './types'
import {
  updateDomainCloudflareStatus,
  type CFSSLStatus,
  type CFOwnershipStatus,
} from '@quackback/db/queries/domains'

// ============================================================================
// Webhook Signature Verification
// ============================================================================

/**
 * Verify Cloudflare webhook signature.
 * Cloudflare sends HMAC-SHA256 signature in cf-webhook-auth header.
 */
export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const secret = process.env.CLOUDFLARE_WEBHOOK_SECRET
  if (!secret) {
    throw new Error('CLOUDFLARE_WEBHOOK_SECRET not configured')
  }

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    // Buffers have different lengths - signatures don't match
    return false
  }
}

// ============================================================================
// Webhook Event Processing
// ============================================================================

/**
 * Process a Cloudflare webhook event.
 * Updates the domain record with current SSL/ownership status.
 * We look up the domain by cloudflareHostnameId since we don't use custom_metadata.
 */
export async function processWebhookEvent(payload: CFWebhookPayload): Promise<boolean> {
  const hostname = payload.data

  console.log(
    `[CF Webhook] Processing ${payload.event} for ${hostname.hostname}: SSL=${hostname.ssl?.status || 'unknown'}, Ownership=${hostname.status}`
  )

  // Update domain record with current status
  // This will only update if the hostname ID exists in our database
  const updated = await updateDomainCloudflareStatus({
    cloudflareHostnameId: hostname.id,
    sslStatus: (hostname.ssl?.status || 'unknown') as CFSSLStatus,
    ownershipStatus: hostname.status as CFOwnershipStatus,
  })

  if (!updated) {
    console.warn('[CF Webhook] No matching domain found for hostname:', hostname.id)
  }

  return updated
}
