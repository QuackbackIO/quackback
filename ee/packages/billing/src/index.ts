/**
 * @quackback/ee/billing - Stripe Billing Integration
 *
 * This package handles Stripe integration for Quackback Cloud:
 * - Checkout sessions for new subscriptions
 * - Customer portal for subscription management
 * - Webhook handling for subscription events
 */

// Stripe client and utilities
export {
  getStripe,
  isStripeConfigured,
  getTierPriceIds,
  getSeatPriceIds,
  getTierFromPriceId,
  getPriceIdForTier,
  getSeatPriceIdForTier,
  createCheckoutSession,
  createPortalSession,
  getStripeSubscription,
  cancelSubscriptionAtPeriodEnd,
  reactivateSubscription,
  updateSubscriptionSeats,
  getSubscriptionSeatInfo,
  calculateExtraSeats,
  constructWebhookEvent,
  INCLUDED_SEATS,
  type PaidTier,
  type CreateCheckoutSessionParams,
  type CreatePortalSessionParams,
  type Stripe,
} from './stripe'

// Webhook handlers
export {
  processWebhookEvent,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  type WebhookEventType,
} from './webhooks'

// Customer data (invoices, payment methods)
export {
  getCustomerInvoices,
  getCustomerPaymentMethods,
  getDefaultPaymentMethod,
  type InvoiceListItem,
  type PaymentMethodInfo,
} from './customer'

// Seat sync (call after member changes)
export { syncWorkspaceSeats, isBillableRole, type SeatSyncResult } from './seat-sync'
