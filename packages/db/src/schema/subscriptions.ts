import { pgTable, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { appUser } from './rls'
import { organization } from './auth'

/**
 * Subscription table - Tracks organization subscription state for cloud deployments
 *
 * Only used when DEPLOYMENT_MODE=cloud. Self-hosted deployments don't need subscriptions
 * as all features are enabled by default.
 *
 * Status values map to Stripe subscription statuses:
 * - 'trialing': Free trial period
 * - 'active': Paid and in good standing
 * - 'past_due': Payment failed, in grace period
 * - 'canceled': Subscription canceled (may still have access until period end)
 * - 'unpaid': Payment failed, access revoked
 */
export const subscription = pgTable(
  'subscription',
  {
    id: typeIdWithDefault('subscription')('id').primaryKey(),
    organizationId: typeIdColumn('org')('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Pricing tier determines feature access
    tier: text('tier').notNull(), // 'essentials' | 'professional' | 'team' | 'enterprise'
    // Subscription status (mirrors Stripe statuses)
    status: text('status').notNull().default('trialing'), // 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'

    // Stripe identifiers
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    stripePriceId: text('stripe_price_id'),

    // Billing period
    currentPeriodStart: timestamp('current_period_start', { withTimezone: true }),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),

    // Cancellation state
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),

    // Trial info
    trialStart: timestamp('trial_start', { withTimezone: true }),
    trialEnd: timestamp('trial_end', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // One subscription per organization
    uniqueIndex('subscription_org_id_idx').on(table.organizationId),
    // Lookup by Stripe customer
    index('subscription_stripe_customer_idx').on(table.stripeCustomerId),
    // Lookup by Stripe subscription
    index('subscription_stripe_sub_idx').on(table.stripeSubscriptionId),
    // RLS policy for tenant isolation
    pgPolicy('subscription_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`organization_id = current_setting('app.organization_id', true)::uuid`,
      withCheck: sql`organization_id = current_setting('app.organization_id', true)::uuid`,
    }),
  ]
).enableRLS()

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  organization: one(organization, {
    fields: [subscription.organizationId],
    references: [organization.id],
  }),
}))
