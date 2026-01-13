import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { z } from 'zod'
import {
  CreditCardIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowTopRightOnSquareIcon,
  DocumentTextIcon,
  ArrowDownTrayIcon,
  SparklesIcon,
  RocketLaunchIcon,
  BuildingOffice2Icon,
  UserGroupIcon,
} from '@heroicons/react/24/outline'
import { CheckIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { isCloud, CLOUD_TIER_CONFIG, CLOUD_SEAT_PRICING, type CloudTier } from '@/lib/features'
import {
  getBillingOverviewFn,
  getInvoicesFn,
  createCheckoutSessionFn,
  createPortalSessionFn,
  type InvoiceListItem,
} from '@/lib/server-functions/billing'
import { cn } from '@/lib/utils'

// ============================================
// Route Configuration
// ============================================

const searchSchema = z.object({
  success: z.boolean().optional(),
  canceled: z.boolean().optional(),
  tab: z.enum(['overview', 'plan', 'payment', 'invoices']).optional(),
})

export const Route = createFileRoute('/admin/settings/billing')({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ search }),
  loader: async ({ context }) => {
    if (isCloud()) {
      await context.queryClient.prefetchQuery({
        queryKey: ['billing', 'overview'],
        queryFn: () => getBillingOverviewFn(),
      })
    }
  },
  component: BillingPage,
})

// ============================================
// Plan Configuration
// ============================================

const TIER_ICONS: Record<CloudTier, typeof SparklesIcon> = {
  free: SparklesIcon,
  pro: RocketLaunchIcon,
  team: UserGroupIcon,
  enterprise: BuildingOffice2Icon,
}

const TIER_COLORS: Record<CloudTier, { bg: string; border: string; text: string; badge: string }> =
  {
    free: {
      bg: 'bg-slate-50 dark:bg-slate-900/50',
      border: 'border-slate-200 dark:border-slate-800',
      text: 'text-slate-600 dark:text-slate-400',
      badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    },
    pro: {
      bg: 'bg-violet-50 dark:bg-violet-950/30',
      border: 'border-violet-200 dark:border-violet-800',
      text: 'text-violet-600 dark:text-violet-400',
      badge: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
    },
    team: {
      bg: 'bg-blue-50 dark:bg-blue-950/30',
      border: 'border-blue-200 dark:border-blue-800',
      text: 'text-blue-600 dark:text-blue-400',
      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
    },
    enterprise: {
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      border: 'border-amber-200 dark:border-amber-800',
      text: 'text-amber-600 dark:text-amber-400',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
    },
  }

const PLAN_FEATURES: Record<CloudTier, { highlights: string[]; details: string[] }> = {
  free: {
    highlights: ['1 feedback board', '1 roadmap', 'Unlimited end users'],
    details: ['Voting & comments', 'Public changelog', 'Basic analytics'],
  },
  pro: {
    highlights: ['5 feedback boards', '5 roadmaps', 'Custom domain'],
    details: [
      'Custom branding',
      'Custom statuses',
      'Priority support',
      'Remove Quackback branding',
    ],
  },
  team: {
    highlights: ['Unlimited boards', 'Unlimited roadmaps', 'Integrations'],
    details: ['Slack integration', 'Linear integration', 'CSV import/export', 'Advanced analytics'],
  },
  enterprise: {
    highlights: ['SSO / SAML', 'SCIM provisioning', 'Audit logs'],
    details: ['API access', 'Dedicated support', 'Custom contracts', 'SLA guarantees'],
  },
}

// ============================================
// Main Component
// ============================================

function BillingPage() {
  const search = Route.useSearch()
  const [activeTab, setActiveTab] = useState<string>(search.tab || 'overview')

  if (!isCloud()) {
    return <NotAvailableInSelfHosted />
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription, payment methods, and invoices
        </p>
      </div>

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

      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="plan">Plans</TabsTrigger>
          <TabsTrigger value="payment">Payment</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <BillingOverviewTab />
        </TabsContent>

        <TabsContent value="plan" className="mt-6">
          <PlanTab />
        </TabsContent>

        <TabsContent value="payment" className="mt-6">
          <PaymentTab />
        </TabsContent>

        <TabsContent value="invoices" className="mt-6">
          <InvoicesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ============================================
// Not Available Component
// ============================================

function NotAvailableInSelfHosted() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription and billing settings
        </p>
      </div>

      <div className="rounded-xl border border-border/50 bg-card shadow-sm">
        <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <CreditCardIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-base font-medium text-foreground mb-1">
            Not available in self-hosted mode
          </h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Billing is only available in the cloud version. Self-hosted deployments are free to use
            with all community features.
          </p>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Overview Tab
// ============================================

function BillingOverviewTab() {
  const { data } = useSuspenseQuery({
    queryKey: ['billing', 'overview'],
    queryFn: () => getBillingOverviewFn(),
  })

  const { subscription, tierConfig, upcomingInvoice } = data
  const tier = (subscription?.tier || 'free') as CloudTier
  const status = subscription?.status || 'active'
  const TierIcon = TIER_ICONS[tier]
  const colors = TIER_COLORS[tier]

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className={cn('rounded-xl border-2 p-6', colors.border, colors.bg)}>
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div
              className={cn('h-12 w-12 rounded-xl flex items-center justify-center', colors.badge)}
            >
              <TierIcon className={cn('h-6 w-6', colors.text)} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold">{tierConfig?.name || 'Free'}</h2>
                <StatusBadge status={status} />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {tierConfig?.price === 0 ? (
                  'Free forever – no credit card required'
                ) : (
                  <>
                    <span className="text-2xl font-bold text-foreground">${tierConfig?.price}</span>
                    <span className="text-muted-foreground">/month</span>
                  </>
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
            <Button
              variant="outline"
              onClick={() => document.querySelector<HTMLButtonElement>('[value="plan"]')?.click()}
            >
              {tier === 'free' ? 'Upgrade' : 'Change Plan'}
            </Button>
          )}
        </div>

        {subscription?.currentPeriodEnd && (
          <div className="mt-6 pt-4 border-t border-border/50">
            <p className="text-sm text-muted-foreground">
              {subscription.cancelAtPeriodEnd
                ? `Access until ${formatDate(subscription.currentPeriodEnd)}`
                : `Next billing date: ${formatDate(subscription.currentPeriodEnd)}`}
            </p>
          </div>
        )}
      </div>

      {/* Plan Limits */}
      <SettingsCard title="Plan Limits" description="Your current plan includes">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <LimitCard
            label="Team Seats"
            value={
              tierConfig?.limits.seats === 'unlimited'
                ? 'Unlimited'
                : String(tierConfig?.limits.seats)
            }
            sublabel={tier !== 'free' ? `+$${CLOUD_SEAT_PRICING[tier]}/seat` : 'included'}
          />
          <LimitCard
            label="Feedback Boards"
            value={
              tierConfig?.limits.boards === 'unlimited'
                ? 'Unlimited'
                : String(tierConfig?.limits.boards)
            }
          />
          <LimitCard
            label="Roadmaps"
            value={
              tierConfig?.limits.roadmaps === 'unlimited'
                ? 'Unlimited'
                : String(tierConfig?.limits.roadmaps)
            }
          />
        </div>
        <div className="mt-4 pt-4 border-t border-border/50">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <CheckIcon className="h-4 w-4 text-green-500" />
            <span>
              <strong>Unlimited end users</strong> – we never charge per voter or commenter
            </span>
          </p>
        </div>
      </SettingsCard>

      {/* Upcoming Invoice */}
      {upcomingInvoice && (
        <SettingsCard title="Upcoming Invoice" description="Your next scheduled payment">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold tabular-nums">
                {formatCurrency(upcomingInvoice.amountDue, upcomingInvoice.currency)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
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

function LimitCard({
  label,
  value,
  sublabel,
}: {
  label: string
  value: string
  sublabel?: string
}) {
  return (
    <div className="text-center p-4 rounded-lg bg-muted/50">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-muted-foreground">{label}</p>
      {sublabel && <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>}
    </div>
  )
}

// ============================================
// Plan Tab
// ============================================

function PlanTab() {
  const { data } = useSuspenseQuery({
    queryKey: ['billing', 'overview'],
    queryFn: () => getBillingOverviewFn(),
  })

  const currentTier = (data.subscription?.tier || 'free') as CloudTier

  return (
    <div className="space-y-6">
      {/* Unlimited Users Banner */}
      <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
            <UserGroupIcon className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="font-medium text-green-700 dark:text-green-400">
              Unlimited end users on every plan
            </p>
            <p className="text-sm text-green-600 dark:text-green-500">
              We never charge per user – 100 or 100,000 voters, same price.
            </p>
          </div>
        </div>
      </div>

      {/* Plan Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
          View full feature comparison
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

  return (
    <div
      className={cn(
        'rounded-xl border-2 p-5 transition-all',
        isCurrentPlan ? 'border-primary ring-2 ring-primary/20' : colors.border,
        isCurrentPlan ? 'bg-primary/5' : 'bg-card hover:shadow-md'
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div
          className={cn(
            'h-10 w-10 rounded-lg flex items-center justify-center shrink-0',
            colors.badge
          )}
        >
          <TierIcon className={cn('h-5 w-5', colors.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{config.name}</h3>
            {isCurrentPlan && (
              <Badge variant="default" className="text-xs">
                Current
              </Badge>
            )}
          </div>
          <div className="mt-1">
            <span className="text-2xl font-bold tabular-nums">${config.price}</span>
            <span className="text-sm text-muted-foreground">/mo</span>
          </div>
        </div>
      </div>

      {/* Seat Info */}
      <p className="text-sm text-muted-foreground mb-4">
        {config.limits.seats === 'unlimited' ? (
          'Unlimited team seats'
        ) : (
          <>
            {config.limits.seats} team seat{Number(config.limits.seats) !== 1 ? 's' : ''} included
            {seatPrice && <span className="text-xs"> · +${seatPrice}/additional seat</span>}
          </>
        )}
      </p>

      {/* Highlights */}
      <div className="space-y-2 mb-4">
        {features.highlights.map((feature) => (
          <div key={feature} className="flex items-center gap-2">
            <CheckIcon className="h-4 w-4 text-green-500 shrink-0" />
            <span className="text-sm font-medium">{feature}</span>
          </div>
        ))}
      </div>

      {/* Details */}
      <div className="space-y-1.5 mb-5 pb-4 border-b border-border/50">
        {features.details.map((feature) => (
          <div key={feature} className="flex items-center gap-2">
            <CheckIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">{feature}</span>
          </div>
        ))}
      </div>

      {/* Action */}
      {isCurrentPlan ? (
        <Button variant="outline" className="w-full" disabled>
          Current Plan
        </Button>
      ) : tier === 'enterprise' ? (
        <Button variant="outline" className="w-full" asChild>
          <a href="mailto:sales@quackback.io">Contact Sales</a>
        </Button>
      ) : tier === 'free' ? (
        <Button variant="ghost" className="w-full" disabled>
          Downgrade
        </Button>
      ) : (
        <Button
          className="w-full"
          variant={isUpgrade ? 'default' : 'outline'}
          onClick={handleUpgrade}
          disabled={isLoading}
        >
          {isLoading ? 'Loading...' : isUpgrade ? `Upgrade to ${config.name}` : 'Switch Plan'}
        </Button>
      )}
    </div>
  )
}

// ============================================
// Payment Tab
// ============================================

function PaymentTab() {
  const [isLoading, setIsLoading] = useState(false)
  const { data } = useSuspenseQuery({
    queryKey: ['billing', 'overview'],
    queryFn: () => getBillingOverviewFn(),
  })

  const hasSubscription = data.subscription?.stripeCustomerId

  const handleManagePayment = async () => {
    setIsLoading(true)
    try {
      const result = await createPortalSessionFn({ data: {} })
      window.location.href = result.url
    } catch (error) {
      console.error('Failed to create portal session:', error)
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Payment Method"
        description="Manage your payment methods and billing information"
      >
        {hasSubscription ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <CreditCardIcon className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="font-medium">Managed by Stripe</p>
                <p className="text-sm text-muted-foreground">
                  Securely update your card or billing details
                </p>
              </div>
            </div>
            <Button variant="outline" onClick={handleManagePayment} disabled={isLoading}>
              {isLoading ? 'Loading...' : 'Manage'}
              <ArrowTopRightOnSquareIcon className="h-4 w-4 ml-2" />
            </Button>
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <CreditCardIcon className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-medium">No payment method on file</p>
            <p className="text-sm text-muted-foreground mt-1">
              Upgrade to a paid plan to add a payment method
            </p>
          </div>
        )}
      </SettingsCard>

      {hasSubscription && (
        <SettingsCard
          title="Billing Portal"
          description="Access your complete billing history and settings"
        >
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium">Update payment methods</p>
              <p className="text-xs text-muted-foreground">Add or remove cards</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium">Download invoices</p>
              <p className="text-xs text-muted-foreground">PDF receipts for all payments</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium">Update billing info</p>
              <p className="text-xs text-muted-foreground">Address and tax details</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/50">
              <p className="text-sm font-medium">Cancel subscription</p>
              <p className="text-xs text-muted-foreground">Manage your plan</p>
            </div>
          </div>
          <Button variant="outline" onClick={handleManagePayment} disabled={isLoading}>
            {isLoading ? 'Loading...' : 'Open Billing Portal'}
            <ArrowTopRightOnSquareIcon className="h-4 w-4 ml-2" />
          </Button>
        </SettingsCard>
      )}
    </div>
  )
}

// ============================================
// Invoices Tab
// ============================================

function InvoicesTab() {
  const { data: invoices } = useSuspenseQuery<InvoiceListItem[]>({
    queryKey: ['billing', 'invoices'],
    queryFn: () => getInvoicesFn({ data: { limit: 20 } }),
  })

  if (invoices.length === 0) {
    return (
      <SettingsCard title="Invoice History" description="Your past invoices and payments">
        <div className="text-center py-12">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <DocumentTextIcon className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="font-medium">No invoices yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Invoices will appear here after your first payment
          </p>
        </div>
      </SettingsCard>
    )
  }

  return (
    <SettingsCard title="Invoice History" description="Your past invoices and payments">
      <div className="divide-y divide-border/50">
        {invoices.map((invoice) => (
          <div
            key={invoice.id}
            className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
          >
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <DocumentTextIcon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">{formatDate(invoice.createdAt)}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {formatCurrency(invoice.amountPaid, invoice.currency)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <InvoiceStatusBadge status={invoice.status} />
              {invoice.pdfUrl && (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={invoice.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Download PDF"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </SettingsCard>
  )
}

// ============================================
// Helper Components
// ============================================

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
    <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', variant.className)}>
      {variant.label}
    </span>
  )
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { label: string; className: string }> = {
    paid: {
      label: 'Paid',
      className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    },
    open: {
      label: 'Open',
      className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    },
    draft: {
      label: 'Draft',
      className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
    },
    void: {
      label: 'Void',
      className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
    },
    uncollectible: {
      label: 'Failed',
      className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    },
  }

  const variant = variants[status] || variants.draft

  return (
    <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium', variant.className)}>
      {variant.label}
    </span>
  )
}

// ============================================
// Utility Functions
// ============================================

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
