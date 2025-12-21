'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Check, Loader2, ExternalLink, AlertCircle } from 'lucide-react'
import { TIER_CONFIG, type PricingTier } from '@quackback/domain/features'
import { BillingUsageDashboard } from './billing-usage-dashboard'
import { BillingTrialProgress } from './billing-trial-progress'
import { BillingPastDueWarning } from './billing-past-due-warning'
import { BillingPaymentMethod } from './billing-payment-method'
import { BillingInvoiceHistory } from './billing-invoice-history'
import { BillingUpgradePrompt } from './billing-upgrade-prompt'

interface SubscriptionData {
  tier: PricingTier
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  trialEnd: string | null
}

interface UsageCounts {
  boards: number
  posts: number
  /** Billable seats (owner + admin roles only) */
  seats: number
}

interface SerializedInvoice {
  id: string
  number: string | null
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void'
  amountDue: number
  amountPaid: number
  currency: string
  created: string
  periodStart: string
  periodEnd: string
  pdfUrl: string | null
  hostedInvoiceUrl: string | null
}

interface PaymentMethodData {
  id: string
  type: 'card' | 'other'
  card: {
    brand: string
    last4: string
    expMonth: number
    expYear: number
  } | null
  isDefault: boolean
}

interface BillingClientProps {
  workspaceId: string
  subscription: SubscriptionData | null
  usage: UsageCounts
  invoices: SerializedInvoice[]
  paymentMethod: PaymentMethodData | null
}

const PLAN_FEATURES: Record<PricingTier, string[]> = {
  free: [
    '1 feedback board',
    'Up to 100 posts',
    '1 admin seat',
    'Public voting & comments',
    'Roadmap & changelog',
  ],
  pro: [
    '5 feedback boards',
    'Up to 1,000 posts',
    '2 seats included (+$15/seat)',
    'Custom domain & branding',
    'Custom statuses',
  ],
  team: [
    'Unlimited boards',
    'Up to 10,000 posts',
    '5 seats included (+$20/seat)',
    'Slack, Linear & Jira integrations',
    'CSV import/export',
  ],
  enterprise: [
    'Unlimited boards & posts',
    '10 seats included (+$30/seat)',
    'SSO/SAML & SCIM',
    'Audit logs & API access',
    'White-label & dedicated support',
  ],
}

export function BillingClient({
  workspaceId,
  subscription,
  usage,
  invoices,
  paymentMethod,
}: BillingClientProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentTier = subscription?.tier
  const isActive = subscription?.status === 'active'
  const isTrialing = subscription?.status === 'trialing'
  const isPastDue = subscription?.status === 'past_due'
  const isCanceled = subscription?.status === 'canceled'
  const hasSubscription = Boolean(subscription?.tier)

  // Calculate usage level for display logic
  const getUsageLevel = (): 'normal' | 'warning' | 'critical' => {
    if (!currentTier) return 'normal'
    const limits = TIER_CONFIG[currentTier].limits
    const percentages = [
      limits.boards !== 'unlimited' ? (usage.boards / limits.boards) * 100 : 0,
      limits.posts !== 'unlimited' ? (usage.posts / limits.posts) * 100 : 0,
      // Note: seats can exceed limit (just billed extra), so we don't count towards critical usage
    ]
    const maxUsage = Math.max(...percentages)
    if (maxUsage >= 95) return 'critical'
    if (maxUsage >= 70) return 'warning'
    return 'normal'
  }
  const usageLevel = getUsageLevel()

  // Show upgrade prompt only for active subscribers not at critical states
  // Don't show during: trial (already converting), past_due (fix payment first), canceled
  const showUpgradePrompt = isActive && currentTier !== 'enterprise'

  // Put upgrade at top if critical usage
  const upgradeAtTop = showUpgradePrompt && usageLevel === 'critical'

  const handleCheckout = async (tier: PricingTier) => {
    if (tier === 'enterprise') {
      window.open('mailto:sales@quackback.io?subject=Enterprise%20Plan%20Inquiry', '_blank')
      return
    }

    setLoading(tier)
    setError(null)

    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, tier }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session')
      }

      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(null)
    }
  }

  const handleManageSubscription = async () => {
    setLoading('portal')
    setError(null)

    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create portal session')
      }

      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(null)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const isPortalLoading = loading === 'portal'

  // Render the upgrade prompt component (used in multiple places conditionally)
  const upgradePrompt = showUpgradePrompt && currentTier && (
    <BillingUpgradePrompt
      currentTier={currentTier}
      usage={usage}
      limits={TIER_CONFIG[currentTier].limits}
      onUpgrade={handleManageSubscription}
      isLoading={isPortalLoading}
    />
  )

  return (
    <div className="space-y-6">
      {/* Error Alert */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-destructive">Error</p>
            <p className="text-sm text-destructive/80">{error}</p>
          </div>
        </div>
      )}

      {/* ===== STATE: PAST DUE ===== */}
      {/* Priority: Fix payment first, no upgrade distractions */}
      {isPastDue && subscription?.currentPeriodEnd && (
        <BillingPastDueWarning
          currentPeriodEnd={subscription.currentPeriodEnd}
          onUpdatePayment={handleManageSubscription}
          isLoading={isPortalLoading}
        />
      )}

      {/* ===== STATE: TRIALING ===== */}
      {/* Show trial progress - they're already converting, don't push upgrade */}
      {isTrialing && subscription?.trialEnd && currentTier && (
        <BillingTrialProgress
          trialEnd={subscription.trialEnd}
          tier={TIER_CONFIG[currentTier].name}
          price={TIER_CONFIG[currentTier].price as number}
          onManageSubscription={handleManageSubscription}
          isLoading={isPortalLoading}
        />
      )}

      {/* ===== STATE: ACTIVE - CRITICAL USAGE ===== */}
      {/* Upgrade prompt at TOP when at limits */}
      {upgradeAtTop && upgradePrompt}

      {/* ===== CURRENT PLAN CARD ===== */}
      {/* Show for active/canceled subscribers (not trialing, not past_due) */}
      {hasSubscription && !isTrialing && !isPastDue && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-medium text-lg">Current Plan</h2>
                {isActive && (
                  <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-green-500/10 text-green-600">
                    Active
                  </span>
                )}
                {isCanceled && (
                  <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-red-500/10 text-red-600">
                    Canceled
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {TIER_CONFIG[currentTier!].name} • ${TIER_CONFIG[currentTier!].price}/month
                {subscription?.currentPeriodEnd && (
                  <>
                    {' '}
                    •{' '}
                    {subscription.cancelAtPeriodEnd
                      ? `Access until ${formatDate(subscription.currentPeriodEnd)}`
                      : `Renews ${formatDate(subscription.currentPeriodEnd)}`}
                  </>
                )}
              </p>
            </div>
            <Button onClick={handleManageSubscription} disabled={isPortalLoading} variant="outline">
              {isPortalLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  Manage
                  <ExternalLink className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ===== USAGE DASHBOARD ===== */}
      {/* Always show for subscribers - this is valuable info */}
      {hasSubscription && currentTier && (
        <BillingUsageDashboard
          usage={usage}
          limits={TIER_CONFIG[currentTier].limits}
          tier={currentTier}
        />
      )}

      {/* ===== UPGRADE PROMPT (non-critical) ===== */}
      {/* Show below usage when not at critical levels */}
      {showUpgradePrompt && !upgradeAtTop && upgradePrompt}

      {/* ===== STATE: CANCELED ===== */}
      {/* Show resubscribe option */}
      {isCanceled && (
        <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-6">
          <h2 className="font-semibold text-lg mb-2">Reactivate Your Subscription</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Your subscription was canceled but you still have access until your current period ends.
            Reactivate to continue using Quackback without interruption.
          </p>
          <Button onClick={handleManageSubscription} disabled={isPortalLoading}>
            {isPortalLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              'Reactivate Subscription'
            )}
          </Button>
        </div>
      )}

      {/* ===== PAYMENT METHOD ===== */}
      {hasSubscription && !isCanceled && (
        <BillingPaymentMethod
          card={paymentMethod?.card ?? null}
          onManage={handleManageSubscription}
          isLoading={isPortalLoading}
        />
      )}

      {/* ===== INVOICE HISTORY ===== */}
      {invoices.length > 0 && <BillingInvoiceHistory invoices={invoices} />}

      {/* ===== STATE: NO SUBSCRIPTION (FREE TIER) ===== */}
      {/* Plans grid for free users to upgrade */}
      {!hasSubscription && (
        <div>
          {/* Show current free tier info */}
          <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm mb-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="font-medium text-lg">Current Plan</h2>
                  <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-muted text-muted-foreground">
                    Free
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Free • $0/month • 1 board, 100 posts, 1 seat
                </p>
              </div>
            </div>
          </div>

          <h2 className="font-medium text-lg mb-4">Upgrade Your Plan</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {(['pro', 'team', 'enterprise'] as PricingTier[]).map((tier) => {
              const config = TIER_CONFIG[tier]
              const features = PLAN_FEATURES[tier]
              const price = `$${config.price}`

              return (
                <div
                  key={tier}
                  className="rounded-xl border border-border/50 bg-card hover:border-border p-5 flex flex-col"
                >
                  <div className="mb-4">
                    <h3 className="font-semibold text-base">{config.name}</h3>
                    <div className="mt-1">
                      <span className="text-2xl font-bold">{price}</span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </div>
                  </div>

                  <ul className="space-y-2 mb-6 flex-1">
                    {features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    variant={tier === 'pro' ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => handleCheckout(tier)}
                    disabled={loading !== null}
                  >
                    {loading === tier ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : tier === 'enterprise' ? (
                      'Contact Sales'
                    ) : (
                      'Start Trial'
                    )}
                  </Button>
                </div>
              )
            })}
          </div>

          <p className="text-sm text-muted-foreground text-center mt-6">
            All paid plans include a 14-day free trial. Credit card required at checkout.
          </p>
        </div>
      )}
    </div>
  )
}
