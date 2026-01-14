import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ArrowTopRightOnSquareIcon,
  SparklesIcon,
  RocketLaunchIcon,
  UserGroupIcon,
  BuildingOffice2Icon,
} from '@heroicons/react/24/outline'
import { CheckIcon, StarIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CLOUD_TIER_CONFIG, CLOUD_SEAT_PRICING, type CloudTier } from '@/lib/features'
import { createCheckoutSessionFn } from '@/lib/server-functions/billing'
import { billingQueries } from '@/lib/queries/billing'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/admin/settings/billing/plans')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(billingQueries.overview())
  },
  component: PlansPage,
})

// Configuration
const TIER_ICONS: Record<CloudTier, typeof SparklesIcon> = {
  free: SparklesIcon,
  pro: RocketLaunchIcon,
  team: UserGroupIcon,
  enterprise: BuildingOffice2Icon,
}

const TIER_COLORS: Record<CloudTier, { text: string; badge: string }> = {
  free: {
    text: 'text-slate-600 dark:text-slate-400',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  pro: {
    text: 'text-violet-600 dark:text-violet-400',
    badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  },
  team: {
    text: 'text-blue-600 dark:text-blue-400',
    badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  },
  enterprise: {
    text: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  },
}

const PLAN_FEATURES: Record<CloudTier, string[]> = {
  free: ['1 board', '1 roadmap', 'Voting & comments', 'Public changelog'],
  pro: ['5 boards', '5 roadmaps', 'Custom domain', 'Custom branding', 'Priority support'],
  team: [
    'Unlimited boards',
    'Unlimited roadmaps',
    'Slack integration',
    'Linear integration',
    'CSV import/export',
  ],
  enterprise: ['SSO / SAML', 'SCIM provisioning', 'Audit logs', 'API access', 'Dedicated support'],
}

function PlansPage() {
  const { data } = useSuspenseQuery(billingQueries.overview())

  const currentTier = (data.subscription?.tier || 'free') as CloudTier

  return (
    <div className="space-y-6">
      {/* Unlimited Users Banner */}
      <div className="rounded-xl border border-green-500/30 bg-green-500/5 px-4 py-3">
        <p className="text-sm flex items-center gap-2">
          <UserGroupIcon className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
          <span>
            <strong className="text-green-700 dark:text-green-400">Unlimited end users</strong>
            <span className="text-green-600 dark:text-green-500">
              {' '}
              on every plan – 100 or 100,000 voters, same price
            </span>
          </span>
        </p>
      </div>

      {/* Plan Cards - 4 column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(['free', 'pro', 'team', 'enterprise'] as CloudTier[]).map((tier) => (
          <PlanCard
            key={tier}
            tier={tier}
            isCurrentPlan={tier === currentTier}
            currentTier={currentTier}
          />
        ))}
      </div>

      {/* Feature Comparison Link */}
      <p className="text-center text-sm text-muted-foreground">
        <a
          href="https://quackback.io/pricing"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors inline-flex items-center gap-1"
        >
          Compare all features
          <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
        </a>
      </p>
    </div>
  )
}

function PlanCard({
  tier,
  isCurrentPlan,
  currentTier,
}: {
  tier: CloudTier
  isCurrentPlan: boolean
  currentTier: CloudTier
}) {
  const [isLoading, setIsLoading] = useState(false)
  const config = CLOUD_TIER_CONFIG[tier]
  const seatPrice = tier !== 'free' ? CLOUD_SEAT_PRICING[tier] : null
  const features = PLAN_FEATURES[tier]
  const colors = TIER_COLORS[tier]
  const TierIcon = TIER_ICONS[tier]

  const handleUpgrade = async () => {
    if (tier === 'free' || tier === 'enterprise') return

    setIsLoading(true)
    try {
      const result = await createCheckoutSessionFn({ data: { tier } })
      window.location.href = result.url
    } catch (error) {
      console.error('Failed to create checkout session:', error)
      setIsLoading(false)
    }
  }

  const tierOrder = ['free', 'pro', 'team', 'enterprise']
  const isUpgrade = tierOrder.indexOf(tier) > tierOrder.indexOf(currentTier)
  const isPopular = tier === 'team'

  return (
    <div
      className={cn(
        'rounded-xl border p-5 flex flex-col relative',
        isCurrentPlan
          ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
          : 'border-border bg-card'
      )}
    >
      {/* Popular Badge */}
      {isPopular && !isCurrentPlan && (
        <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
          <Badge className="bg-blue-600 hover:bg-blue-600 text-white text-[10px] px-2 py-0.5 flex items-center gap-1">
            <StarIcon className="h-3 w-3" />
            POPULAR
          </Badge>
        </div>
      )}

      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className={cn('h-7 w-7 rounded-lg flex items-center justify-center', colors.badge)}>
            <TierIcon className={cn('h-4 w-4', colors.text)} />
          </div>
          <span className="font-semibold">{config.name}</span>
          {isCurrentPlan && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              YOU
            </Badge>
          )}
        </div>

        {/* Price */}
        <div className="mt-2">
          <span className="text-3xl font-bold tabular-nums">${config.price}</span>
          <span className="text-muted-foreground text-sm">/mo</span>
        </div>

        {/* Seats */}
        <p className="text-xs text-muted-foreground mt-1">
          {config.limits.seats === 'unlimited' ? (
            'Unlimited seats'
          ) : (
            <>
              {config.limits.seats} seat{Number(config.limits.seats) !== 1 ? 's' : ''}
              {seatPrice && <span> · +${seatPrice}/seat</span>}
            </>
          )}
        </p>
      </div>

      {/* Features */}
      <ul className="space-y-2 flex-1 mb-4">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            <CheckIcon className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>

      {/* Action */}
      {isCurrentPlan ? (
        <Button variant="outline" size="sm" className="w-full" disabled>
          Current Plan
        </Button>
      ) : tier === 'enterprise' ? (
        <Button variant="outline" size="sm" className="w-full" asChild>
          <a href="mailto:sales@quackback.io">Contact Sales</a>
        </Button>
      ) : tier === 'free' ? (
        <Button variant="ghost" size="sm" className="w-full text-muted-foreground" disabled>
          Downgrade
        </Button>
      ) : (
        <Button
          size="sm"
          className="w-full"
          variant={isUpgrade ? 'default' : 'outline'}
          onClick={handleUpgrade}
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : isUpgrade ? 'Upgrade' : 'Switch'}
        </Button>
      )}
    </div>
  )
}
