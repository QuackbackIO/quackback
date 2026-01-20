import { createFileRoute } from '@tanstack/react-router'

/**
 * Stripe Webhook Handler
 *
 * Receives webhook events from Stripe for subscription and invoice updates.
 * Updates the catalog database directly (no tenant context needed).
 *
 * Webhook events handled:
 * - checkout.session.completed: Initial subscription created
 * - customer.subscription.created/updated/deleted: Subscription state changes
 * - invoice.paid/payment_failed: Payment status updates
 *
 * @see https://stripe.com/docs/webhooks
 */

type StripeEventType =
  | 'checkout.session.completed'
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'customer.updated'

const HANDLED_EVENTS: StripeEventType[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
]

export const Route = createFileRoute('/api/stripe/webhook')({
  server: {
    handlers: {
      /**
       * POST /api/stripe/webhook
       * Handle Stripe webhook events.
       */
      POST: async ({ request }) => {
        // Dynamic imports to avoid loading Stripe in non-cloud environments
        const { getStripe, isStripeConfigured } = await import('@/lib/stripe')
        const {
          getWorkspaceIdFromStripeCustomer,
          upsertStripeCustomer,
          syncSubscriptionFromStripe,
          syncInvoiceFromStripe,
          markSubscriptionCanceled,
        } = await import('@/lib/stripe/catalog-billing.service')

        console.log(`[stripe-webhook] Received webhook event`)

        // Check if Stripe is configured
        if (!isStripeConfigured()) {
          console.warn(`[stripe-webhook] Stripe is not configured`)
          return new Response('Stripe not configured', { status: 400 })
        }

        try {
          const stripe = getStripe()

          // Get the raw body for signature verification
          const body = await request.text()
          const signature = request.headers.get('stripe-signature')

          if (!signature) {
            console.warn(`[stripe-webhook] Missing stripe-signature header`)
            return new Response('Missing signature', { status: 400 })
          }

          // Verify webhook signature
          const webhookSecret = process.env.CLOUD_STRIPE_WEBHOOK_SECRET
          if (!webhookSecret) {
            console.error(`[stripe-webhook] CLOUD_STRIPE_WEBHOOK_SECRET not configured`)
            return new Response('Webhook secret not configured', { status: 500 })
          }

          let event
          try {
            event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error'
            console.error(`[stripe-webhook] Signature verification failed: ${message}`)
            return new Response(`Webhook signature verification failed: ${message}`, {
              status: 400,
            })
          }

          console.log(`[stripe-webhook] Event: type=${event.type}, id=${event.id}`)

          // Check if this is an event type we handle
          if (!HANDLED_EVENTS.includes(event.type as StripeEventType)) {
            console.log(`[stripe-webhook] Ignoring event type: ${event.type}`)
            return new Response('OK', { status: 200 })
          }

          // Helper to resolve workspaceId from Stripe customer
          async function resolveWorkspaceId(customerId: string): Promise<string | null> {
            // First try catalog lookup
            let workspaceId = await getWorkspaceIdFromStripeCustomer(customerId)

            if (!workspaceId) {
              // Fallback: get from Stripe customer metadata
              const customer = await stripe.customers.retrieve(customerId)
              if (!customer.deleted && customer.metadata?.workspaceId) {
                workspaceId = customer.metadata.workspaceId
                // Cache the mapping for future lookups
                await upsertStripeCustomer(customerId, workspaceId, customer.email ?? undefined)
              }
            }

            return workspaceId
          }

          // Handle the event
          switch (event.type) {
            case 'checkout.session.completed': {
              const session = event.data.object
              console.log(`[stripe-webhook] Checkout completed: ${session.id}`)

              // If subscription was created, fetch and sync it
              if (session.subscription) {
                const subscriptionId =
                  typeof session.subscription === 'string'
                    ? session.subscription
                    : session.subscription.id

                const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId)
                const customerId =
                  typeof stripeSubscription.customer === 'string'
                    ? stripeSubscription.customer
                    : stripeSubscription.customer.id

                const workspaceId = await resolveWorkspaceId(customerId)
                if (!workspaceId) {
                  console.error(`[stripe-webhook] No workspaceId for customer: ${customerId}`)
                  return new Response('Workspace not found', { status: 400 })
                }

                await syncSubscriptionFromStripe(stripeSubscription, workspaceId)
                console.log(`[stripe-webhook] Synced subscription from checkout: ${subscriptionId}`)
              }
              break
            }

            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
              const stripeSubscription = event.data.object
              const customerId =
                typeof stripeSubscription.customer === 'string'
                  ? stripeSubscription.customer
                  : stripeSubscription.customer.id

              const workspaceId = await resolveWorkspaceId(customerId)
              if (!workspaceId) {
                console.error(`[stripe-webhook] No workspaceId for customer: ${customerId}`)
                return new Response('Workspace not found', { status: 400 })
              }

              await syncSubscriptionFromStripe(stripeSubscription, workspaceId)
              console.log(`[stripe-webhook] Synced subscription: ${stripeSubscription.id}`)
              break
            }

            case 'customer.subscription.deleted': {
              const stripeSubscription = event.data.object
              const customerId =
                typeof stripeSubscription.customer === 'string'
                  ? stripeSubscription.customer
                  : stripeSubscription.customer.id

              await markSubscriptionCanceled(customerId)
              console.log(`[stripe-webhook] Marked subscription canceled: ${stripeSubscription.id}`)
              break
            }

            case 'invoice.paid':
            case 'invoice.payment_failed': {
              const stripeInvoice = event.data.object
              const customerId =
                typeof stripeInvoice.customer === 'string'
                  ? stripeInvoice.customer
                  : stripeInvoice.customer?.id

              if (!customerId) {
                console.error(`[stripe-webhook] No customer on invoice: ${stripeInvoice.id}`)
                return new Response('Invoice has no customer', { status: 400 })
              }

              const workspaceId = await resolveWorkspaceId(customerId)
              if (!workspaceId) {
                console.error(`[stripe-webhook] No workspaceId for customer: ${customerId}`)
                return new Response('Workspace not found', { status: 400 })
              }

              await syncInvoiceFromStripe(stripeInvoice, workspaceId)
              console.log(
                `[stripe-webhook] Synced invoice: ${stripeInvoice.id}, status=${stripeInvoice.status}`
              )
              break
            }

            default:
              console.log(`[stripe-webhook] Unhandled event type: ${event.type}`)
          }

          return new Response('OK', { status: 200 })
        } catch (error) {
          console.error(`[stripe-webhook] Error processing webhook:`, error)

          // Return 500 so Stripe will retry
          return new Response('Internal error', { status: 500 })
        }
      },
    },
  },
})
