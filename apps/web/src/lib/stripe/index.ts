/**
 * Stripe integration for Quackback Cloud
 *
 * Handles subscription management, checkout, and billing portal.
 */

// Client
export { getStripe, isStripeConfigured } from './client'

// Prices
export { getTierPriceId, getSeatPriceId, getConfiguredPrices, arePricesConfigured } from './prices'

// Subscription service
export {
  // Customer management
  createStripeCustomer,
  getOrCreateStripeCustomer,
  // Checkout
  createCheckoutSession,
  type CreateCheckoutOptions,
  // Portal
  createPortalSession,
  // Subscription management
  getSubscription,
  createFreeSubscription,
  syncSubscriptionFromStripe,
  markSubscriptionCanceled,
  // Invoice management
  getInvoices,
  syncInvoiceFromStripe,
  getUpcomingInvoice,
  type UpcomingInvoicePreview,
} from './subscription.service'
