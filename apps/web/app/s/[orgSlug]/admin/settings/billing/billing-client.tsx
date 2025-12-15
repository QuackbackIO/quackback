'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Check, Loader2, ExternalLink, AlertCircle } from 'lucide-react'
import { TIER_CONFIG, type PricingTier } from '@quackback/domain/features'

interface SubscriptionData {
  tier: PricingTier | null
  status: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  trialEnd: string | null
}

interface BillingClientProps {
  organizationId: string
  subscription: SubscriptionData | null
}

const PLAN_FEATURES: Record<PricingTier, string[]> = {
  essentials: [
    '1 feedback board',
    'Up to 100 posts',
    'Public voting & comments',
    'Basic roadmap',
    'Changelog',
  ],
  professional: [
    '3 feedback boards',
    'Up to 1,000 posts',
    'Custom domain',
    'Webhooks & API access',
    'Custom branding',
  ],
  team: [
    '10 feedback boards',
    'Up to 10,000 posts',
    'SSO/SAML authentication',
    'Audit logs',
    'All integrations',
  ],
  enterprise: [
    'Unlimited boards & posts',
    'Extended audit logs',
    'White-label option',
    'Dedicated support',
    'Custom SLA',
  ],
}

export function BillingClient({ organizationId, subscription }: BillingClientProps) {
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const currentTier = subscription?.tier
  const isActive = subscription?.status === 'active'
  const isTrialing = subscription?.status === 'trialing'
  const isPastDue = subscription?.status === 'past_due'
  const isCanceled = subscription?.status === 'canceled'
  const hasSubscription = Boolean(subscription?.tier)

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
        body: JSON.stringify({ organizationId, tier }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session')
      }

      // Redirect to Stripe Checkout
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
        body: JSON.stringify({ organizationId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create portal session')
      }

      // Redirect to Stripe Customer Portal
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

      {/* Current Subscription Status */}
      {hasSubscription && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-medium text-lg">Current Plan</h2>
              <p className="text-sm text-muted-foreground">
                {TIER_CONFIG[currentTier!].name} • ${TIER_CONFIG[currentTier!].price}/month
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isTrialing && (
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-blue-500/10 text-blue-600">
                  Trial
                </span>
              )}
              {isActive && (
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-green-500/10 text-green-600">
                  Active
                </span>
              )}
              {isPastDue && (
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-amber-500/10 text-amber-600">
                  Past Due
                </span>
              )}
              {isCanceled && (
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-red-500/10 text-red-600">
                  Canceled
                </span>
              )}
            </div>
          </div>

          {/* Trial/Renewal Info */}
          {isTrialing && subscription.trialEnd && (
            <p className="text-sm text-muted-foreground mb-4">
              Trial ends on {formatDate(subscription.trialEnd)}
            </p>
          )}
          {(isActive || isPastDue) && subscription.currentPeriodEnd && (
            <p className="text-sm text-muted-foreground mb-4">
              {subscription.cancelAtPeriodEnd
                ? `Access until ${formatDate(subscription.currentPeriodEnd)}`
                : `Renews on ${formatDate(subscription.currentPeriodEnd)}`}
            </p>
          )}

          {/* Manage Button */}
          <Button onClick={handleManageSubscription} disabled={loading === 'portal'}>
            {loading === 'portal' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                Manage Subscription
                <ExternalLink className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}

      {/* Plans Grid - Only show for users without a subscription */}
      {!hasSubscription && (
        <div>
          <h2 className="font-medium text-lg mb-4">Choose a Plan</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(['essentials', 'professional', 'team', 'enterprise'] as PricingTier[]).map((tier) => {
              const config = TIER_CONFIG[tier]
              const features = PLAN_FEATURES[tier]
              const price = config.price === 'custom' ? 'Custom' : `$${config.price}`

              return (
                <div
                  key={tier}
                  className="rounded-xl border border-border/50 bg-card hover:border-border p-5 flex flex-col"
                >
                  {/* Plan Name & Price */}
                  <div className="mb-4">
                    <h3 className="font-semibold text-base">{config.name}</h3>
                    <div className="mt-1">
                      <span className="text-2xl font-bold">{price}</span>
                      {config.price !== 'custom' && (
                        <span className="text-sm text-muted-foreground">/mo</span>
                      )}
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="space-y-2 mb-6 flex-1">
                    {features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Action Button */}
                  <Button
                    variant={tier === 'professional' ? 'default' : 'outline'}
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

          {/* Trial Note */}
          <p className="text-sm text-muted-foreground text-center mt-6">
            All plans include a 14-day free trial. Credit card required at checkout.
          </p>
        </div>
      )}

      {/* Plan Change Note - For existing subscribers */}
      {hasSubscription && !isCanceled && (
        <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
          <h2 className="font-medium text-lg mb-2">Change or Cancel Plan</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Use the Stripe Customer Portal to upgrade, downgrade, or cancel your subscription.
            Changes take effect immediately with prorated billing.
          </p>
          <Button onClick={handleManageSubscription} disabled={loading === 'portal'}>
            {loading === 'portal' ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                Open Customer Portal
                <ExternalLink className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
