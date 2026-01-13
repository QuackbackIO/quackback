import { createFileRoute } from '@tanstack/react-router'

/**
 * Cloudflare Custom Hostname Webhook Handler
 *
 * Receives webhook events from Cloudflare for custom hostname SSL/ownership status changes.
 * Updates the workspace_domain table in the catalog database accordingly.
 *
 * Webhook events handled:
 * - ssl.custom_hostname_certificate.validation.succeeded/failed
 * - ssl.custom_hostname_certificate.issuance.succeeded/failed
 * - ssl.custom_hostname_certificate.deployment.succeeded/failed
 * - ssl.custom_hostname_certificate.renewal.succeeded/failed
 *
 * @see https://developers.cloudflare.com/ssl/ssl-for-saas/custom-hostname-webhooks/
 */

// SSL status mapping based on Cloudflare event types
type SslEventType =
  | 'ssl.custom_hostname_certificate.validation.succeeded'
  | 'ssl.custom_hostname_certificate.validation.failed'
  | 'ssl.custom_hostname_certificate.issuance.succeeded'
  | 'ssl.custom_hostname_certificate.issuance.failed'
  | 'ssl.custom_hostname_certificate.deployment.succeeded'
  | 'ssl.custom_hostname_certificate.deployment.failed'
  | 'ssl.custom_hostname_certificate.renewal.succeeded'
  | 'ssl.custom_hostname_certificate.renewal.failed'

interface CloudflareWebhookPayload {
  type: SslEventType
  data: {
    custom_hostname_id: string
    hostname?: string
    ssl?: {
      status?: string
      validation_errors?: Array<{ message: string }>
    }
    ownership_verification?: {
      type?: string
      status?: string
    }
  }
}

interface StatusUpdate {
  sslStatus: string
  ownershipStatus: string
}

/**
 * Map Cloudflare event type to domain status updates.
 * Returns the new SSL and ownership status values.
 */
function getStatusUpdates(eventType: SslEventType): StatusUpdate | null {
  switch (eventType) {
    // Validation events
    case 'ssl.custom_hostname_certificate.validation.succeeded':
      return { sslStatus: 'pending_issuance', ownershipStatus: 'pending' }
    case 'ssl.custom_hostname_certificate.validation.failed':
      return { sslStatus: 'pending_validation', ownershipStatus: 'pending' }

    // Issuance events
    case 'ssl.custom_hostname_certificate.issuance.succeeded':
      return { sslStatus: 'pending_deployment', ownershipStatus: 'pending' }
    case 'ssl.custom_hostname_certificate.issuance.failed':
      return { sslStatus: 'pending_validation', ownershipStatus: 'pending' }

    // Deployment events (final success state)
    case 'ssl.custom_hostname_certificate.deployment.succeeded':
      return { sslStatus: 'active', ownershipStatus: 'active' }
    case 'ssl.custom_hostname_certificate.deployment.failed':
      return { sslStatus: 'pending_validation', ownershipStatus: 'pending' }

    // Renewal events
    case 'ssl.custom_hostname_certificate.renewal.succeeded':
      return { sslStatus: 'active', ownershipStatus: 'active' }
    case 'ssl.custom_hostname_certificate.renewal.failed':
      return { sslStatus: 'pending_validation', ownershipStatus: 'active' }

    default:
      return null
  }
}

export const Route = createFileRoute('/api/cloudflare/webhook')({
  server: {
    handlers: {
      /**
       * POST /api/cloudflare/webhook
       * Handle Cloudflare custom hostname status webhook events.
       */
      POST: async ({ request }) => {
        const { updateDomainFromWebhook } = await import('@/lib/domains/domains.service')

        console.log(`[cloudflare-webhook] Received webhook event`)

        try {
          // Verify webhook secret if configured
          const webhookSecret = process.env.CLOUD_CLOUDFLARE_WEBHOOK_SECRET
          if (webhookSecret) {
            const authHeader = request.headers.get('cf-webhook-auth')
            if (authHeader !== webhookSecret) {
              console.warn(`[cloudflare-webhook] Invalid webhook secret`)
              return new Response('Unauthorized', { status: 401 })
            }
          }

          // Parse webhook payload
          const body = (await request.json()) as CloudflareWebhookPayload

          const eventType = body.type
          const hostnameId = body.data?.custom_hostname_id
          const hostname = body.data?.hostname

          console.log(
            `[cloudflare-webhook] Event: type=${eventType}, hostnameId=${hostnameId}, hostname=${hostname}`
          )

          // Validate required fields
          if (!eventType) {
            console.warn(`[cloudflare-webhook] Missing event type`)
            return new Response('Missing event type', { status: 400 })
          }

          if (!hostnameId) {
            console.warn(`[cloudflare-webhook] Missing hostname ID`)
            return new Response('Missing hostname ID', { status: 400 })
          }

          // Check if this is an event type we handle
          const updates = getStatusUpdates(eventType)
          if (!updates) {
            console.log(`[cloudflare-webhook] Unknown event type: ${eventType}`)
            // Return success for unknown events to avoid Cloudflare retries
            return new Response('OK', { status: 200 })
          }

          // Update the domain status using the existing service
          await updateDomainFromWebhook(hostnameId, updates.sslStatus, updates.ownershipStatus)

          console.log(
            `[cloudflare-webhook] Updated domain for hostname ${hostnameId}: sslStatus=${updates.sslStatus}, ownershipStatus=${updates.ownershipStatus}`
          )

          return new Response('OK', { status: 200 })
        } catch (error) {
          console.error(`[cloudflare-webhook] Error processing webhook:`, error)

          // Return 500 so Cloudflare will retry
          return new Response('Internal error', { status: 500 })
        }
      },
    },
  },
})
