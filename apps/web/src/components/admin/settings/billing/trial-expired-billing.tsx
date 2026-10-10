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
import { INLINE_LINK } from '@/components/admin/settings/inline-link'
import { LocalDate } from '@/components/ui/local-date'
import { CHOICE_DUE_FORMAT } from '@/components/admin/plan-notice-choice-due'
import { TRIAL_CHOICE_GATE_FROM, TRIAL_CHOICE_GRACE_MS } from '@/lib/shared/billing/trial-state'
import { useHydrated } from '@tanstack/react-router'

/**
 * What happened and what is being asked. Billing managers land here from every
 * admin page once the grace period is over, so this says why, and what opens
 * the rest of admin again. Whether the grace is still running depends on the
 * viewer's clock, so that sentence waits for hydration rather than flashing.
 */
function TrialChoiceLead(props: {
  trialPlanName: string | null
  trialExpiresAt: string | null
  choseFree: boolean
}) {
  const hydrated = useHydrated()
  const expires = props.trialExpiresAt ? Date.parse(props.trialExpiresAt) : Number.NaN
  const dueAt = Number.isNaN(expires)
    ? null
    : new Date(Math.max(expires + TRIAL_CHOICE_GRACE_MS, TRIAL_CHOICE_GATE_FROM))
  const graceLeft = hydrated && dueAt !== null && dueAt.getTime() > Date.now()
  const name = props.trialPlanName
  return (
    <div className="space-y-1.5">
      <h2 className="text-base font-semibold">
        {name ? `Your ${name} trial has ended` : 'Your trial has ended'}
      </h2>
      <p className="text-sm text-muted-foreground">
        {props.choseFree
          ? "You chose Free. Remove what's over Free's limits, then confirm the switch."
          : `Choose how this workspace continues: ${name ? `keep ${name}` : 'pick a paid plan'}, or switch to Free once anything over Free's limits is removed. Everything you built is still here.`}
      </p>
      {hydrated ? (
        <p className="text-sm text-muted-foreground">
          {dueAt && graceLeft ? (
            <>
              The rest of admin stays open until{' '}
              <LocalDate date={dueAt} options={CHOICE_DUE_FORMAT} locale="en-US" />. After that it
              waits until a plan is chosen.
            </>
          ) : props.choseFree ? (
            'Until you switch, only this page and the pages that fix those limits are open.'
          ) : (
            'The rest of admin opens again as soon as you choose a plan.'
          )}
        </p>
      ) : null}
    </div>
  )
}

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

  return (
    <div className="space-y-6">
      <TrialChoiceLead
        trialPlanName={overview.trialPlanName ?? null}
        trialExpiresAt={overview.trialExpiresAt}
        choseFree={props.pending?.planId === 'free'}
      />

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
              savingsLabel={annualSavingsLabel(paidSelected)}
              onChange={setPeriod}
            />
          </div>

          {props.catalogueError ? (
            <p role="alert" className="text-[13px] text-destructive">
              Couldn’t load plans. {props.catalogueError}
            </p>
          ) : null}

          <div data-settings-card="" className="overflow-hidden rounded-xl border bg-card">
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
                        <Badge size="sm" variant="secondary">
                          Current
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[13px] text-muted-foreground">{plan.bestFor}</p>
                    {plan.id === 'free' ? (
                      <span
                        className={`${INLINE_LINK} mt-2 inline-flex text-[13px]`}
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
                      {plan.id === 'free' ? 'forever' : '/mo'}
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
          <div data-settings-card="" className="rounded-xl border bg-card p-5">
            <h3 className="text-sm font-semibold">Order summary</h3>
            {paidSelected ? (
              <OrderSummary plan={paidSelected} period={period} />
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
          period={period}
          onOpenChange={setSubscribeOpen}
        />
      ) : null}
      {freeOpen ? (
        <FreeDowngradeDialog open onOpenChange={setFreeOpen} cancelLabel="Back to plans" />
      ) : null}
    </div>
  )
}

function OrderSummary(props: {
  plan: BillingCatalogue['plans'][number]
  period: 'monthly' | 'annual'
}) {
  const yearly = props.period === 'annual'
  const unit = yearly ? props.plan.priceYearlyCents : props.plan.priceMonthlyCents
  const monthly = yearly ? Math.round(unit / 12) : unit
  return (
    <dl className="mt-4 space-y-2 text-[13px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <dt className="font-medium">{props.plan.name} plan</dt>
          <dd className="text-muted-foreground">{yearly ? 'Billed yearly' : 'Billed monthly'}</dd>
        </div>
        <dd className="font-medium tabular-nums">
          {formatUsd(unit, 0)}
          {yearly ? '/year' : '/mo'}
        </dd>
      </div>
      <div className="flex items-center justify-between border-t border-border/50 pt-2">
        <dt className="font-medium">Total</dt>
        <dd className="font-medium tabular-nums">
          {formatUsd(unit, 0)}
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
