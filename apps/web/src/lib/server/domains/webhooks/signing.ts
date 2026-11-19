/**
 * How every webhook Quackback sends is signed, so a receiver verifies them all
 * the same way: `X-Quackback-Signature: sha256=<hex>` is HMAC-SHA256 of
 * `"<X-Quackback-Timestamp>.<raw body>"` under the receiver's secret.
 *
 * Outgoing webhooks and app webhooks sign with the secret stored for their
 * endpoint. A workflow's "Send webhook" step has no endpoint row: its secret is
 * derived from the step's URL (`workflowWebhookSecret`), so every receiver gets
 * its own secret, nothing is stored, and steps saved before signing existed are
 * signed too. An admin reads it in the step's inspector to set up the receiver.
 */
import crypto from 'crypto'
import { deriveLabelledSecret } from '@/lib/server/encryption'

/** The signature headers for a webhook body, signed now unless `at` is given. */
export function webhookSignatureHeaders(
  secret: string,
  body: string,
  at: Date = new Date()
): { 'X-Quackback-Signature': string; 'X-Quackback-Timestamp': string } {
  const timestamp = String(Math.floor(at.getTime() / 1000))
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return { 'X-Quackback-Signature': `sha256=${signature}`, 'X-Quackback-Timestamp': timestamp }
}

const WORKFLOW_WEBHOOK_PURPOSE = 'workflow-webhook-signing'

/**
 * The signing secret for a workflow webhook sent to `url`, in the same
 * `whsec_` form as an outgoing webhook's. The same URL always has the same
 * secret, in every workflow, so a receiver is set up once; a different URL has
 * a different one, so no receiver can sign as another. To change a receiver's
 * secret, change its URL.
 */
export function workflowWebhookSecret(url: string): string {
  return `whsec_${deriveLabelledSecret(WORKFLOW_WEBHOOK_PURPOSE, url).toString('base64url')}`
}
