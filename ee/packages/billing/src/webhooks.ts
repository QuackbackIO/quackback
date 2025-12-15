import type Stripe from 'stripe'
import { getTierFromPriceId, getStripeSubscription } from './stripe'
import {
  upsertSubscription,
  updateSubscriptionByStripeId,
  getSubscriptionByStripeSubscriptionId,
  type SubscriptionStatus,
  type SubscriptionTier,
} from '@quackback/db/queries/subscriptions'
import type { OrgId } from '@quackback/ids'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Safely extract the first subscription item from a Stripe subscription.
 * Returns null if no items exist, preventing undefined access errors.
 */
function getFirstSubscriptionItem(
  subscription: Stripe.Subscription
): Stripe.SubscriptionItem | null {
  const items = subscription.items?.data
  if (!items || items.length === 0) {
    console.error(`Subscription ${subscription.id} has no items - cannot extract pricing data`)
    return null
  }
  return items[0]
}

/**
 * Safely extract customer ID from Stripe object.
 * Handles both string ID and expanded Customer object forms.
 */
function extractCustomerId(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | null {
  if (!customer) return null
  if (typeof customer === 'string') return customer
  return customer.id ?? null
}

/**
 * Safely extract subscription ID from Stripe object.
 * Handles both string ID and expanded Subscription object forms.
 */
function extractSubscriptionId(
  subscription: string | Stripe.Subscription | null | undefined
): string | null {
  if (!subscription) return null
  if (typeof subscription === 'string') return subscription
  return subscription.id ?? null
}

// ============================================================================
// Webhook Event Handlers
// ============================================================================

/**
 * Handle checkout.session.completed - New subscription created
 */
export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const organizationIdParam = session.metadata?.organizationId
  const tier = session.metadata?.tier as SubscriptionTier | undefined

  if (!organizationIdParam || !tier) {
    console.error('Missing metadata in checkout session:', session.id)
    return
  }
  const organizationId = organizationIdParam as OrgId

  const subscriptionId = extractSubscriptionId(session.subscription)
  const customerId = extractCustomerId(session.customer)

  if (!subscriptionId || !customerId) {
    console.error('Missing subscription or customer ID in checkout session:', session.id)
    return
  }

  // Retrieve subscription details to get period info
  const stripeSubscription = await getStripeSubscription(subscriptionId)

  // In Stripe API 2025-11-17.clover, period fields are on items, not subscription
  const firstItem = getFirstSubscriptionItem(stripeSubscription)
  if (!firstItem) {
    console.error('Cannot process checkout: subscription has no items', {
      sessionId: session.id,
      subscriptionId,
    })
    return
  }

  await upsertSubscription({
    organizationId,
    tier,
    status: mapStripeStatus(stripeSubscription.status),
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripePriceId: firstItem.price.id,
    currentPeriodStart: firstItem.current_period_start
      ? new Date(firstItem.current_period_start * 1000)
      : undefined,
    currentPeriodEnd: firstItem.current_period_end
      ? new Date(firstItem.current_period_end * 1000)
      : undefined,
    trialStart: stripeSubscription.trial_start
      ? new Date(stripeSubscription.trial_start * 1000)
      : undefined,
    trialEnd: stripeSubscription.trial_end
      ? new Date(stripeSubscription.trial_end * 1000)
      : undefined,
  })

  console.log(`Subscription created for org ${organizationId}: ${subscriptionId}`)
}

/**
 * Handle customer.subscription.updated - Subscription changed (upgrade/downgrade, renewal, etc.)
 */
export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const existing = await getSubscriptionByStripeSubscriptionId(subscription.id)

  // In Stripe API 2025-11-17.clover, period fields are on items, not subscription
  const firstItem = getFirstSubscriptionItem(subscription)
  if (!firstItem) {
    console.error('Cannot process subscription update: no items', {
      subscriptionId: subscription.id,
    })
    return
  }

  const priceId = firstItem.price.id
  const tier = priceId ? getTierFromPriceId(priceId) : null

  if (!existing) {
    // This might happen if webhook arrives before checkout completion
    // Try to get org ID from metadata
    const organizationIdParam = subscription.metadata?.organizationId
    if (organizationIdParam) {
      const organizationId = organizationIdParam as OrgId
      const customerId = extractCustomerId(subscription.customer)
      if (!customerId) {
        console.error('Cannot extract customer ID from subscription:', subscription.id)
        return
      }

      await upsertSubscription({
        organizationId,
        tier: tier ?? 'essentials',
        status: mapStripeStatus(subscription.status),
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        currentPeriodStart: firstItem.current_period_start
          ? new Date(firstItem.current_period_start * 1000)
          : undefined,
        currentPeriodEnd: firstItem.current_period_end
          ? new Date(firstItem.current_period_end * 1000)
          : undefined,
        trialStart: subscription.trial_start
          ? new Date(subscription.trial_start * 1000)
          : undefined,
        trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : undefined,
      })
    }
    return
  }

  await updateSubscriptionByStripeId(subscription.id, {
    tier: tier ?? (existing.tier as SubscriptionTier),
    status: mapStripeStatus(subscription.status),
    stripePriceId: priceId ?? existing.stripePriceId ?? undefined,
    currentPeriodStart: firstItem.current_period_start
      ? new Date(firstItem.current_period_start * 1000)
      : undefined,
    currentPeriodEnd: firstItem.current_period_end
      ? new Date(firstItem.current_period_end * 1000)
      : undefined,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : undefined,
  })

  console.log(`Subscription updated: ${subscription.id}`)
}

/**
 * Handle customer.subscription.deleted - Subscription canceled/ended
 */
export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  await updateSubscriptionByStripeId(subscription.id, {
    status: 'canceled',
    canceledAt: new Date(),
  })

  console.log(`Subscription deleted: ${subscription.id}`)
}

/**
 * Handle invoice.payment_succeeded - Successful payment
 * In Stripe API 2025-11-17.clover, subscription is under parent.subscription_details
 */
export async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  // Extract subscription ID from parent.subscription_details (2025-11-17.clover API)
  const subscriptionDetails = invoice.parent?.subscription_details
  const subscriptionId =
    typeof subscriptionDetails?.subscription === 'string'
      ? subscriptionDetails.subscription
      : (subscriptionDetails?.subscription?.id ?? null)

  if (!subscriptionId) {
    return // One-time payment, not subscription
  }

  // Update subscription status to active (in case it was past_due)
  await updateSubscriptionByStripeId(subscriptionId, {
    status: 'active',
  })

  console.log(`Payment succeeded for subscription: ${subscriptionId}`)
}

/**
 * Handle invoice.payment_failed - Failed payment
 * In Stripe API 2025-11-17.clover, subscription is under parent.subscription_details
 */
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  // Extract subscription ID from parent.subscription_details (2025-11-17.clover API)
  const subscriptionDetails = invoice.parent?.subscription_details
  const subscriptionId =
    typeof subscriptionDetails?.subscription === 'string'
      ? subscriptionDetails.subscription
      : (subscriptionDetails?.subscription?.id ?? null)

  if (!subscriptionId) {
    return
  }

  // Mark subscription as past_due
  await updateSubscriptionByStripeId(subscriptionId, {
    status: 'past_due',
  })

  console.log(`Payment failed for subscription: ${subscriptionId}`)
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map Stripe subscription status to our status.
 */
function mapStripeStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
      return 'trialing'
    case 'active':
      return 'active'
    case 'past_due':
      return 'past_due'
    case 'canceled':
      return 'canceled'
    case 'unpaid':
      return 'unpaid'
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
    default:
      return 'canceled'
  }
}

// ============================================================================
// Main Webhook Handler
// ============================================================================

export type WebhookEventType =
  | 'checkout.session.completed'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.payment_succeeded'
  | 'invoice.payment_failed'

/**
 * Process a Stripe webhook event.
 * Returns true if the event was handled, false if ignored.
 */
export async function processWebhookEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
      return true

    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
      return true

    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
      return true

    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice)
      return true

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
      return true

    default:
      // Unhandled event type
      return false
  }
}
