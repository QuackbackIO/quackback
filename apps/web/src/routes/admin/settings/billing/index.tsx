import { createFileRoute, useSearch, Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  SparklesIcon,
  RocketLaunchIcon,
  UserGroupIcon,
  BuildingOffice2Icon,
} from '@heroicons/react/24/outline'
import { CheckIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { CLOUD_SEAT_PRICING, type CloudTier } from '@/lib/features'
import { billingQueries } from '@/lib/queries/billing'
import { cn } from '@/lib/utils'

// Search params for success/cancel messages
const searchSchema = z.object({
  success: z.boolean().optional(),
  canceled: z.boolean().optional(),
})

export const Route = createFileRoute('/admin/settings/billing/')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(billingQueries.overview())
  },
  component: BillingOverviewPage,
})

// Tier icons and colors
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

function BillingOverviewPage() {
  const search = useSearch({ from: '/admin/settings/billing/' })
  const { data } = useSuspenseQuery(billingQueries.overview())

  const { subscription, tierConfig, upcomingInvoice, usage } = data
  const tier = (subscription?.tier || 'free') as CloudTier
  const status = subscription?.status || 'active'
  const TierIcon = TIER_ICONS[tier]
  const colors = TIER_COLORS[tier]

  // Calculate seat info
  const seatsIncluded =
    tierConfig?.limits.seats === 'unlimited' ? null : Number(tierConfig?.limits.seats)
  const seatsUsed = usage?.seats ?? 1
  const seatsTotal = seatsIncluded ? seatsIncluded + (subscription?.seatsAdditional || 0) : null

  return (
    <div className="space-y-6">
      {/* Success/Cancel Messages */}
      {search.success && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-green-500/30 bg-green-500/10">
          <CheckCircleIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
          <div>
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              Payment successful!
            </p>
            <p className="text-xs text-green-600 dark:text-green-500">
              Your subscription has been updated.
            </p>
          </div>
        </div>
      )}

      {search.canceled && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10">
          <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
          <div>
            <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
              Checkout canceled
            </p>
            <p className="text-xs text-yellow-600 dark:text-yellow-500">
              No changes were made to your subscription.
            </p>
          </div>
        </div>
      )}

      {/* Current Plan Card */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div
              className={cn('h-12 w-12 rounded-xl flex items-center justify-center', colors.badge)}
            >
              <TierIcon className={cn('h-6 w-6', colors.text)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">{tierConfig?.name || 'Free'} Plan</h2>
                <StatusBadge status={status} />
              </div>
              <p className="text-muted-foreground mt-1">
                {tierConfig?.price === 0 ? (
                  'Free forever'
                ) : (
                  <>
                    <span className="text-2xl font-bold text-foreground">${tierConfig?.price}</span>
                    <span>/month</span>
                  </>
                )}
                {seatsIncluded && (
                  <span className="text-sm ml-2">
                    · {seatsIncluded} seat{seatsIncluded !== 1 ? 's' : ''} included
                    {tier !== 'free' && ` (+$${CLOUD_SEAT_PRICING[tier]}/additional)`}
                  </span>
                )}
              </p>
              {subscription?.cancelAtPeriodEnd && (
                <p className="text-sm text-yellow-600 dark:text-yellow-400 mt-2">
                  Cancels at end of billing period
                </p>
              )}
            </div>
          </div>
          {tier !== 'enterprise' && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/settings/billing/plans">Change Plan</Link>
            </Button>
          )}
        </div>

        {subscription?.currentPeriodEnd && (
          <div className="mt-4 pt-4 border-t border-border/50 text-sm text-muted-foreground">
            {subscription.cancelAtPeriodEnd
              ? `Access until ${formatDate(subscription.currentPeriodEnd)}`
              : `Next billing: ${formatDate(subscription.currentPeriodEnd)}`}
          </div>
        )}
      </div>

      {/* Usage Section */}
      <SettingsCard title="Usage This Period" description="Your current resource consumption">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <UsageMeter
            label="Team Seats"
            used={seatsUsed}
            limit={seatsTotal ?? 'unlimited'}
            action={
              tier !== 'free' && seatsTotal ? (
                <button className="text-xs text-primary hover:underline flex items-center gap-1">
                  <PlusIcon className="h-3 w-3" />
                  Add seat (+${CLOUD_SEAT_PRICING[tier]})
                </button>
              ) : null
            }
          />
          <UsageMeter
            label="Feedback Boards"
            used={usage?.boards ?? 0}
            limit={
              tierConfig?.limits.boards === 'unlimited'
                ? 'unlimited'
                : Number(tierConfig?.limits.boards)
            }
          />
          <UsageMeter
            label="Roadmaps"
            used={usage?.roadmaps ?? 0}
            limit={
              tierConfig?.limits.roadmaps === 'unlimited'
                ? 'unlimited'
                : Number(tierConfig?.limits.roadmaps)
            }
          />
        </div>

        <div className="mt-4 pt-4 border-t border-border/50">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <CheckIcon className="h-4 w-4 text-green-500 shrink-0" />
            <span>
              <strong>Unlimited end users</strong> – we never charge per voter or commenter
            </span>
          </p>
        </div>
      </SettingsCard>

      {/* Upcoming Invoice */}
      {upcomingInvoice && (
        <SettingsCard title="Next Invoice" description="Your upcoming scheduled payment">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold tabular-nums">
                {formatCurrency(upcomingInvoice.amountDue, upcomingInvoice.currency)}
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                Due{' '}
                {upcomingInvoice.periodEnd
                  ? formatDate(upcomingInvoice.periodEnd)
                  : 'at period end'}
              </p>
            </div>
          </div>
        </SettingsCard>
      )}
    </div>
  )
}

// Components

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    active: {
      label: 'Active',
      className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    },
    trialing: {
      label: 'Trial',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    past_due: {
      label: 'Past Due',
      className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    },
    canceled: {
      label: 'Canceled',
      className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
    },
    unpaid: {
      label: 'Unpaid',
      className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    },
  }

  const variant = variants[status] || variants.active

  return (
    <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', variant.className)}>
      {variant.label}
    </span>
  )
}

function UsageMeter({
  label,
  used,
  limit,
  action,
}: {
  label: string
  used: number
  limit: number | 'unlimited'
  action?: React.ReactNode
}) {
  const isUnlimited = limit === 'unlimited'
  const percentage = isUnlimited ? 0 : Math.min((used / limit) * 100, 100)
  const isNearLimit = !isUnlimited && percentage >= 80
  const isAtLimit = !isUnlimited && used >= limit

  return (
    <div className="p-4 rounded-lg border border-border/50 bg-muted/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">{label}</span>
        <span className={cn('text-sm tabular-nums', isAtLimit && 'text-red-600 dark:text-red-400')}>
          {isUnlimited ? (
            <span className="text-muted-foreground">Unlimited</span>
          ) : (
            <>
              {used} <span className="text-muted-foreground">/ {limit}</span>
            </>
          )}
        </span>
      </div>

      {!isUnlimited && (
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              isAtLimit ? 'bg-red-500' : isNearLimit ? 'bg-yellow-500' : 'bg-primary'
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}

      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// Utilities

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCurrency(amountInCents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountInCents / 100)
}
