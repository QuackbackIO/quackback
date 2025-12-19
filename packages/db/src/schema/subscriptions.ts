import { pgTable, text, timestamp, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import { pgPolicy } from 'drizzle-orm/pg-core'
import { typeIdWithDefault, typeIdColumn } from '@quackback/ids/drizzle'
import { appUser } from './rls'
import { workspace } from './auth'

/**
 * Subscription table - Tracks workspace subscription state for cloud deployments
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
    workspaceId: typeIdColumn('workspace')('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
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
    // One subscription per workspace
    uniqueIndex('subscription_workspace_id_idx').on(table.workspaceId),
    // Lookup by Stripe customer
    index('subscription_stripe_customer_idx').on(table.stripeCustomerId),
    // Lookup by Stripe subscription
    index('subscription_stripe_sub_idx').on(table.stripeSubscriptionId),
    // RLS policy for tenant isolation
    pgPolicy('subscription_tenant_isolation', {
      for: 'all',
      to: appUser,
      using: sql`workspace_id = current_setting('app.workspace_id', true)::uuid`,
      withCheck: sql`workspace_id = current_setting('app.workspace_id', true)::uuid`,
    }),
  ]
).enableRLS()

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  workspace: one(workspace, {
    fields: [subscription.workspaceId],
    references: [workspace.id],
  }),
}))
