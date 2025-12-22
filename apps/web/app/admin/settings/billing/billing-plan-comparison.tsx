'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { TIER_CONFIG, type PricingTier } from '@quackback/domain/features'
import { cn } from '@/lib/utils'

interface PlanComparisonProps {
  currentTier: PricingTier
  onUpgrade: () => void
  isLoading: boolean
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

const TIER_ORDER: PricingTier[] = ['free', 'pro', 'team', 'enterprise']

export function BillingPlanComparison({ currentTier, onUpgrade, isLoading }: PlanComparisonProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const currentTierIndex = TIER_ORDER.indexOf(currentTier)

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
      >
        <div>
          <h2 className="font-medium text-left">Compare Plans</h2>
          <p className="text-sm text-muted-foreground text-left">
            See what's available on higher tiers
          </p>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="border-t border-border/50 p-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {TIER_ORDER.map((tier, index) => {
              const config = TIER_CONFIG[tier]
              const features = PLAN_FEATURES[tier]
              const isCurrent = tier === currentTier
              const isUpgrade = index > currentTierIndex
              const price = `$${config.price}`

              return (
                <div
                  key={tier}
                  className={cn(
                    'rounded-xl border p-5 flex flex-col',
                    isCurrent
                      ? 'border-primary bg-primary/5'
                      : 'border-border/50 hover:border-border'
                  )}
                >
                  {/* Plan Name & Price */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-base">{config.name}</h3>
                      {isCurrent && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary/10 text-primary">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="mt-1">
                      <span className="text-2xl font-bold">{price}</span>
                      <span className="text-sm text-muted-foreground">/mo</span>
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="space-y-2 mb-6 flex-1">
                    {features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check
                          className={cn(
                            'h-4 w-4 shrink-0 mt-0.5',
                            isCurrent ? 'text-primary' : 'text-muted-foreground'
                          )}
                        />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* Action Button */}
                  {isCurrent ? (
                    <Button variant="outline" disabled className="w-full">
                      Current Plan
                    </Button>
                  ) : isUpgrade ? (
                    <Button
                      variant={tier === 'pro' ? 'default' : 'outline'}
                      className="w-full"
                      onClick={onUpgrade}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : tier === 'enterprise' ? (
                        'Contact Sales'
                      ) : (
                        'Upgrade'
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={onUpgrade}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        'Downgrade'
                      )}
                    </Button>
                  )}
                </div>
              )
            })}
          </div>

          <p className="text-xs text-muted-foreground text-center mt-6">
            Changes are prorated. Manage your subscription in the Stripe Customer Portal.
          </p>
        </div>
      )}
    </div>
  )
}
