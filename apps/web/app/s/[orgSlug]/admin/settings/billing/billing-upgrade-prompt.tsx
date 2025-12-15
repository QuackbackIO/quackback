'use client'

import { Button } from '@/components/ui/button'
import { Check, Loader2, Sparkles, TrendingUp } from 'lucide-react'
import { TIER_CONFIG, type PricingTier } from '@quackback/domain/features'

interface UpgradePromptProps {
  currentTier: PricingTier
  usage: {
    boards: number
    posts: number
    teamMembers: number
  }
  limits: {
    boards: number | 'unlimited'
    posts: number | 'unlimited'
    teamMembers: number | 'unlimited'
  }
  onUpgrade: () => void
  isLoading: boolean
}

const TIER_ORDER: PricingTier[] = ['essentials', 'professional', 'team', 'enterprise']

const UPGRADE_FEATURES: Record<PricingTier, string[]> = {
  essentials: [], // No upgrade from nothing
  professional: [
    '3 feedback boards (vs 1)',
    '1,000 posts (vs 100)',
    'Custom domain',
    'API access & webhooks',
  ],
  team: [
    '10 feedback boards',
    '10,000 posts',
    'SSO/SAML authentication',
    'Slack, Discord & GitHub integrations',
  ],
  enterprise: ['Unlimited everything', 'Dedicated support', 'Custom SLA', 'White-label option'],
}

function getUsagePercentage(current: number, limit: number | 'unlimited'): number {
  if (limit === 'unlimited') return 0
  return (current / limit) * 100
}

function getHighestUsageMetric(
  usage: UpgradePromptProps['usage'],
  limits: UpgradePromptProps['limits']
): { metric: string; percentage: number } {
  const metrics = [
    { metric: 'boards', percentage: getUsagePercentage(usage.boards, limits.boards) },
    { metric: 'posts', percentage: getUsagePercentage(usage.posts, limits.posts) },
    {
      metric: 'team members',
      percentage: getUsagePercentage(usage.teamMembers, limits.teamMembers),
    },
  ]
  return metrics.reduce((a, b) => (a.percentage > b.percentage ? a : b))
}

export function BillingUpgradePrompt({
  currentTier,
  usage,
  limits,
  onUpgrade,
  isLoading,
}: UpgradePromptProps) {
  const currentTierIndex = TIER_ORDER.indexOf(currentTier)
  const nextTier =
    currentTierIndex < TIER_ORDER.length - 1 ? TIER_ORDER[currentTierIndex + 1] : null

  // Don't show if already on highest tier
  if (!nextTier || currentTier === 'enterprise') {
    return null
  }

  const nextTierConfig = TIER_CONFIG[nextTier]
  const upgradeFeatures = UPGRADE_FEATURES[nextTier]
  const highestUsage = getHighestUsageMetric(usage, limits)
  const isApproachingLimits = highestUsage.percentage >= 70
  const isAtLimits = highestUsage.percentage >= 95

  // Determine urgency level for styling
  const isUrgent = isAtLimits
  const isWarning = isApproachingLimits && !isAtLimits

  return (
    <div
      className={`rounded-xl border-2 p-6 shadow-sm ${
        isUrgent
          ? 'border-amber-500 bg-amber-500/5'
          : isWarning
            ? 'border-primary/50 bg-primary/5'
            : 'border-primary/30 bg-gradient-to-br from-primary/5 to-transparent'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-start gap-6">
        {/* Left: Upgrade messaging */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {isUrgent ? (
              <TrendingUp className="h-5 w-5 text-amber-600" />
            ) : (
              <Sparkles className="h-5 w-5 text-primary" />
            )}
            <h2
              className={`font-semibold text-lg ${isUrgent ? 'text-amber-600' : 'text-foreground'}`}
            >
              {isUrgent
                ? `You've reached your ${highestUsage.metric} limit`
                : isWarning
                  ? `You're using ${Math.round(highestUsage.percentage)}% of your ${highestUsage.metric}`
                  : `Unlock more with ${nextTierConfig.name}`}
            </h2>
          </div>

          <p className="text-sm text-muted-foreground mb-4">
            {isUrgent
              ? `Upgrade to ${nextTierConfig.name} to continue growing your feedback program.`
              : isWarning
                ? `Upgrade to ${nextTierConfig.name} before you hit your limits.`
                : `Get more boards, posts, and powerful features with ${nextTierConfig.name}.`}
          </p>

          {/* Feature highlights */}
          <ul className="space-y-2 mb-4">
            {upgradeFeatures.slice(0, 4).map((feature, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-primary shrink-0" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Right: Price and CTA */}
        <div className="lg:text-right lg:min-w-[180px]">
          <div className="mb-3">
            <div className="text-3xl font-bold">
              {nextTierConfig.price === 'custom' ? 'Custom' : `$${nextTierConfig.price}`}
            </div>
            {nextTierConfig.price !== 'custom' && (
              <div className="text-sm text-muted-foreground">per month</div>
            )}
          </div>

          <Button
            onClick={onUpgrade}
            disabled={isLoading}
            size="lg"
            className={`w-full lg:w-auto ${isUrgent ? 'bg-amber-600 hover:bg-amber-700' : ''}`}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : nextTier === 'enterprise' ? (
              'Contact Sales'
            ) : (
              `Upgrade to ${nextTierConfig.name}`
            )}
          </Button>

          {nextTier !== 'enterprise' && (
            <p className="text-xs text-muted-foreground mt-2">Prorated billing • Cancel anytime</p>
          )}
        </div>
      </div>
    </div>
  )
}
