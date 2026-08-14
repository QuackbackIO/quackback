import { useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import { billingQueries } from '@/lib/client/queries/billing'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Workspace-local presentation of the control-plane billing projection. */
export function BillingSettings() {
  const { data } = useSuspenseQuery(billingQueries.overview())
  if (!data) return null
  return <BillingBody overview={data} />
}

function BillingBody({ overview }: { overview: BillingProjectionOverview }) {
  const [targetPlan, setTargetPlan] = useState<'growth' | 'pro' | 'scale'>(
    overview.purchasablePlans.find((plan) => plan.id !== overview.plan)?.id ?? 'growth'
  )
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Current plan"
        description="Commercial access is kept up to date by Quackback Cloud."
      >
        <div className="space-y-3 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{overview.planName}</span>
            {overview.status && (
              <Badge size="sm" shape="pill" variant={statusVariant(overview.status)}>
                {STATUS_LABELS[overview.status] ?? overview.status}
              </Badge>
            )}
          </div>
          {overview.trialExpiresAt && (
            <p className="text-[13px] text-muted-foreground">
              Pro trial ends on {formatDate(overview.trialExpiresAt)}.
            </p>
          )}
          {overview.renewalAt && (
            <p className="text-[13px] text-muted-foreground">
              Renews on {formatDate(overview.renewalAt)}.
            </p>
          )}
          {overview.cancellationAt && (
            <p className="text-[13px] text-muted-foreground">
              Access ends on {formatDate(overview.cancellationAt)}.
            </p>
          )}
        </div>
      </SettingsCard>

      {(overview.canUpgrade || overview.canManageBilling) && (
        <SettingsCard
          title="Plan & billing"
          description="Checkout and account management open securely with our billing provider."
        >
          <div className="flex flex-wrap items-end gap-3 px-4 py-4 sm:px-6">
            {overview.canUpgrade && (
              <>
                <div className="space-y-1.5">
                  <label className="text-[13px] text-muted-foreground" htmlFor="billing-plan">
                    Plan
                  </label>
                  <Select
                    value={targetPlan}
                    onValueChange={(value) => setTargetPlan(value as typeof targetPlan)}
                  >
                    <SelectTrigger size="sm" id="billing-plan" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {overview.purchasablePlans.map((plan) => (
                        <SelectItem key={plan.id} value={plan.id}>
                          {plan.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[13px] text-muted-foreground" htmlFor="billing-period">
                    Billing period
                  </label>
                  <Select
                    value={billingPeriod}
                    onValueChange={(value) => setBillingPeriod(value as typeof billingPeriod)}
                  >
                    <SelectTrigger size="sm" id="billing-period" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <form method="post" action="/api/billing/session">
                  <input type="hidden" name="action" value="checkout" />
                  <input type="hidden" name="planId" value={targetPlan} />
                  <input type="hidden" name="billingPeriod" value={billingPeriod} />
                  <Button
                    size="sm"
                    type="submit"
                    variant={overview.canManageBilling ? 'outline' : 'default'}
                  >
                    {overview.plan === 'free' ? 'Upgrade' : 'Change plan'}
                    <ArrowTopRightOnSquareIcon className="size-4" />
                  </Button>
                </form>
              </>
            )}
            {overview.canManageBilling && (
              <form method="post" action="/api/billing/session">
                <input type="hidden" name="action" value="portal" />
                <Button size="sm" type="submit">
                  Manage billing
                  <ArrowTopRightOnSquareIcon className="size-4" />
                </Button>
              </form>
            )}
          </div>
        </SettingsCard>
      )}
    </div>
  )
}

const STATUS_LABELS: Record<string, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  canceled: 'Cancelled',
  paused: 'Paused',
}

function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'active' || status === 'trialing') return 'secondary'
  if (status === 'past_due' || status === 'canceled') return 'destructive'
  return 'outline'
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
