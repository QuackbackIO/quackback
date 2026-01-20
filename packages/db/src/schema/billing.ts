/**
 * @deprecated These tables have been moved to the catalog database.
 * This file is kept for migration compatibility only.
 * Use @/lib/catalog/schema for billing operations.
 *
 * Original description:
 * Billing schema for cloud subscription management.
 * Tracks workspace subscriptions and invoices, integrated with Stripe.
 * Only used in cloud edition (multi-tenant mode).
 */
import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, integer, pgEnum, index } from 'drizzle-orm/pg-core'
import { typeIdWithDefault } from '@quackback/ids/drizzle'

// ============================================
// Enums
// ============================================

/**
 * Cloud subscription tiers
 * Matches CloudTier type from @/lib/features
 */
export const cloudTierEnum = pgEnum('cloud_tier', ['free', 'pro', 'team', 'enterprise'])

/**
 * Subscription status
 * Maps to Stripe subscription statuses
 */
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
])

/**
 * Invoice status
 * Maps to Stripe invoice statuses
 */
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'open',
  'paid',
  'void',
  'uncollectible',
])

// ============================================
// Tables
// ============================================

/**
 * Subscriptions table - Tracks workspace subscription state
 *
 * One subscription per workspace (tenant). Synced from Stripe via webhooks.
 * Free tier workspaces have a subscription record with tier='free' and no stripeSubscriptionId.
 */
export const billingSubscriptions = pgTable(
  'billing_subscriptions',
  {
    id: typeIdWithDefault('subscription')('id').primaryKey(),

    // Stripe references
    stripeCustomerId: text('stripe_customer_id').notNull(),
    stripeSubscriptionId: text('stripe_subscription_id'), // null for free tier

    // Plan info
    tier: cloudTierEnum('tier').notNull().default('free'),
    status: subscriptionStatusEnum('status').notNull().default('active'),

    // Seats
    seatsIncluded: integer('seats_included').notNull().default(1),
    seatsAdditional: integer('seats_additional').notNull().default(0),

    // Billing cycle
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),

    // Trial
    trialStart: timestamp('trial_start', { withTimezone: true }),
    trialEnd: timestamp('trial_end', { withTimezone: true }),

    // Metadata
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('subscriptions_stripe_customer_idx').on(table.stripeCustomerId),
    index('subscriptions_stripe_subscription_idx').on(table.stripeSubscriptionId),
  ]
)

/**
 * Invoices table - Tracks billing history
 *
 * Synced from Stripe via webhooks. Used to display invoice history in billing settings.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: typeIdWithDefault('invoice')('id').primaryKey(),

    // Stripe reference
    stripeInvoiceId: text('stripe_invoice_id').notNull().unique(),

    // Amount (in cents)
    amountDue: integer('amount_due').notNull(),
    amountPaid: integer('amount_paid').notNull(),
    currency: text('currency').notNull().default('usd'),

    // Status
    status: invoiceStatusEnum('status').notNull(),

    // URLs
    invoiceUrl: text('invoice_url'), // Stripe hosted invoice page
    pdfUrl: text('pdf_url'), // Direct PDF download

    // Billing period
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),

    // Metadata
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('invoices_stripe_invoice_idx').on(table.stripeInvoiceId)]
)

// ============================================
// Relations
// ============================================

export const billingSubscriptionsRelations = relations(billingSubscriptions, () => ({}))

export const invoicesRelations = relations(invoices, () => ({}))
