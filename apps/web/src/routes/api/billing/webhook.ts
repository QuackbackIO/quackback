import { createFileRoute } from '@tanstack/react-router'
import {
  handleBillingWebhook,
  SIGNATURE_HEADER,
} from '@/lib/server/domains/billing/webhook.service'

/**
 * Billing provider webhook endpoint.
 *
 * Unauthenticated by design — the provider has no credential to present — and
 * therefore authenticated by signature instead. `request.text()` is
 * deliberate: the signature covers the exact bytes sent, so parsing to JSON
 * and re-serialising would fail every verification.
 *
 * This is billing for *this workspace's* subscription to Quackback. It is
 * unrelated to the payment-provider integration under
 * `apps/web/src/integrations/`, which reads a *customer's* own account to
 * enrich their feedback — same vendor, opposite direction of money.
 *
 * On an install with no billing provider configured this route exists but
 * answers 400 to everything, touching neither the database nor the network.
 */
export const Route = createFileRoute('/api/billing/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text()
        const outcome = await handleBillingWebhook(
          rawBody,
          request.headers.get(SIGNATURE_HEADER)
        )
        return new Response(JSON.stringify(outcome.body), {
          status: outcome.status,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  },
})
