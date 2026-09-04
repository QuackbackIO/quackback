import { useEffect, useState } from 'react'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/shared/utils'
import { formatUsd } from '@/lib/shared/format-usd'
import { annualSavingsLabel } from '@/lib/shared/billing/checkout-path'
import {
  billingPlanAction,
  catalogueTrialedPlanIds,
  type PaidPlanId,
} from '@/lib/shared/billing/plan-action'
import { FreeDowngradeDialog } from './free-downgrade-dialog'
import { SubscribeDialog } from './subscribe-dialog'

export function TrialExpiredBilling(props: {
  overview: BillingProjectionOverview
  catalogue: BillingCatalogue | null
  catalogueError: string | null
  pending?: { planId: string; planName: string } | null
}) {
  const [period, setPeriod] = useState<'monthly' | 'annual'>('annual')
  const [selectedId, setSelectedId] = useState<PaidPlanId | 'free'>(
    (props.overview.trialPlanId as PaidPlanId | undefined) ?? 'pro'
  )
  const [subscribeOpen, setSubscribeOpen] = useState(false)
  const [freeOpen, setFreeOpen] = useState(false)

  useEffect(() => {
    if (props.pending?.planId === 'free') setFreeOpen(true)
  }, [props.pending?.planId])
  const { overview, catalogue } = props
  const trialedPlanIds = catalogueTrialedPlanIds(catalogue)
  const plans = catalogue?.plans ?? []
  const selected = plans.find((plan) => plan.id === selectedId)
  const paidSelected = selected && selected.id !== 'free' ? selected : null
  const checkoutQuantity = Math.max(overview.seats?.used ?? 1, 1)
  const trialName = overview.trialPlanName ?? 'your plan'

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Need more time to test everything? Pick a plan below, including Free after you remove
        anything that exceeds it.
      </p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                1 Configure plan
              </p>
              <h2 className="mt-1 text-base font-semibold">Billing cycle</h2>
            </div>
            <PeriodToggle
              value={period}
              discountMonths={catalogue?.annualDiscountMonths ?? 2}
              savingsLabel={annualSavingsLabel(paidSelected)}
              onChange={setPeriod}
            />
          </div>

          {props.catalogueError ? (
            <p role="alert" className="text-[13px] text-destructive">
              Couldn’t load plans. {props.catalogueError}
            </p>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
            {plans.map((plan) => {
              const action = billingPlanAction(plan.id, overview, trialedPlanIds)
              const isCurrent = overview.trialPlanId
                ? plan.id === overview.trialPlanId
                : plan.id === 'free'
              const isSelected = plan.id === selectedId
              const monthly =
                period === 'annual'
                  ? Math.round(plan.priceYearlyCents / 12)
                  : plan.priceMonthlyCents
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => setSelectedId(plan.id as PaidPlanId | 'free')}
                  className={cn(
                    'flex w-full items-start justify-between gap-3 border-b border-border/50 px-5 py-4 text-left last:border-b-0',
                    isSelected && 'bg-primary/5'
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold">{plan.name}</span>
                      {isCurrent ? (
                        <Badge size="sm" shape="pill" variant="secondary">
                          Current
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">{plan.bestFor}</p>
                    {plan.id === 'free' ? (
                      <span
                        className="mt-2 inline-flex text-[13px] font-medium text-primary"
                        onClick={(e) => {
                          e.stopPropagation()
                          setFreeOpen(true)
                        }}
                      >
                        Downgrade to Free plan
                      </span>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-right">
                    <span className="text-lg font-semibold tabular-nums">
                      {formatUsd(monthly, 0)}
                    </span>
                    <span className="block text-[12px] text-muted-foreground">
                      {plan.id === 'free'
                        ? 'forever'
                        : plan.billedPer === 'seat'
                          ? '/seat/mo'
                          : '/mo'}
                    </span>
                  </p>
                  {action.kind === 'subscribe' || action.kind === 'current' ? (
                    <span className="sr-only">{plan.name}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>

        <aside className="space-y-3 lg:pt-8">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            2 Payment
          </p>
          <div className="rounded-xl border border-border/50 bg-card p-5">
            <h3 className="text-sm font-semibold">Order summary</h3>
            {paidSelected ? (
              <OrderSummary plan={paidSelected} period={period} seats={checkoutQuantity} />
            ) : (
              <p className="mt-3 text-[13px] text-muted-foreground">
                Free has no charge. Resolve anything over the Free caps, then switch.
              </p>
            )}
            {paidSelected ? (
              <Button className="mt-4 w-full" type="button" onClick={() => setSubscribeOpen(true)}>
                Continue to payment
              </Button>
            ) : (
              <Button className="mt-4 w-full" type="button" onClick={() => setFreeOpen(true)}>
                Switch to Free
              </Button>
            )}
          </div>
        </aside>
      </div>

      {paidSelected && subscribeOpen ? (
        <SubscribeDialog
          open
          plan={paidSelected}
          endsTrial
          minSeats={checkoutQuantity}
          discountMonths={catalogue?.annualDiscountMonths ?? 2}
          period={period}
          onOpenChange={setSubscribeOpen}
        />
      ) : null}
      {freeOpen ? <FreeDowngradeDialog open onOpenChange={setFreeOpen} /> : null}
      <p className="sr-only">Your {trialName} trial has ended.</p>
    </div>
  )
}

function OrderSummary(props: {
  plan: BillingCatalogue['plans'][number]
  period: 'monthly' | 'annual'
  seats: number
}) {
  const yearly = props.period === 'annual'
  const billedPerSeat = props.plan.billedPer === 'seat'
  const unit = yearly ? props.plan.priceYearlyCents : props.plan.priceMonthlyCents
  const quantity = billedPerSeat ? props.seats : 1
  const total = unit * quantity
  const monthly = yearly ? Math.round(total / 12) : total
  return (
    <dl className="mt-4 space-y-2 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <dt className="font-medium">{props.plan.name} plan</dt>
          <dd className="text-muted-foreground">
            {billedPerSeat
              ? `${quantity} seat${quantity === 1 ? '' : 's'} × ${formatUsd(unit, 0)}/${yearly ? 'year' : 'mo'}`
              : yearly
                ? 'Billed yearly'
                : 'Billed monthly'}
          </dd>
        </div>
        <dd className="font-medium tabular-nums">
          {formatUsd(total, 0)}
          {yearly ? '/year' : '/mo'}
        </dd>
      </div>
      <div className="flex items-center justify-between border-t border-border/50 pt-2">
        <dt className="font-medium">Total</dt>
        <dd className="font-medium tabular-nums">
          {formatUsd(total, 0)}
          {yearly ? '/year' : '/mo'}
        </dd>
      </div>
      {yearly ? (
        <div className="flex items-center justify-between text-muted-foreground">
          <dt>Monthly equivalent</dt>
          <dd className="tabular-nums">{formatUsd(monthly, 0)}/mo</dd>
        </div>
      ) : null}
    </dl>
  )
}

function PeriodToggle(props: {
  value: 'monthly' | 'annual'
  discountMonths: number
  savingsLabel: string | null
  onChange: (next: 'monthly' | 'annual') => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="inline-flex items-center rounded-full border border-border/50 bg-muted/30 p-0.5"
    >
      {(['monthly', 'annual'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={props.value === option}
          onClick={() => props.onChange(option)}
          className={cn(
            'inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium',
            props.value === option
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option === 'annual' ? (
            <>
              Yearly
              {props.savingsLabel ? (
                <span className="ms-1.5 text-[11px] font-semibold text-primary">
                  {props.savingsLabel}
                </span>
              ) : null}
            </>
          ) : (
            'Monthly'
          )}
        </button>
      ))}
    </div>
  )
}
