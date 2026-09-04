import { Suspense, useState } from 'react'
import { ArrowTopRightOnSquareIcon, CheckIcon, LockClosedIcon } from '@heroicons/react/24/solid'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useLocation, useRouteContext } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { billingQueries } from '@/lib/client/queries/billing'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { formatUsd } from '@/lib/shared/format-usd'
import {
  catalogueTrialDays,
  catalogueTrialedPlanIds,
  type PaidPlanId,
} from '@/lib/shared/billing/plan-action'
import { annualSavingsLabel, checkoutPath, isPaidPlanId } from '@/lib/shared/billing/checkout-path'
import {
  cataloguePlanFor,
  unlockedHighlights,
  upgradeLead,
  type UpgradeDescription,
} from '@/lib/shared/describe-upgrade'
import { cn } from '@/lib/shared/utils'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import type { UpgradeContext } from '@/lib/server/domains/settings/cloud/upgrade-context'

type BillingPeriod = 'monthly' | 'annual'

const PLANS_PATH = '/admin/settings/billing'

type UpgradeOfferProps = {
  description: UpgradeDescription
  dismissLabel?: string
  onDismiss?: () => void
  className?: string
}

/**
 * The one upgrade body. Card, in-route screen, and modal all render this.
 *
 * It names the feature that was just attempted, the plan the workspace is on,
 * the plan that includes the feature, and everything that move unlocks — the
 * same catalogue Plan & billing renders. Both the catalogue and the upgrade
 * context are prefetched in the route loader so the first paint is complete.
 */
export function UpgradeOffer(props: UpgradeOfferProps) {
  const { billingEnabled } = useRouteContext({ from: '__root__' })
  const canCheckout = usePermission(PERMISSIONS.BILLING_MANAGE)
  if (!billingEnabled) {
    return (
      <OfferFrame
        {...props}
        catalogue={null}
        context={null}
        canCheckout={false}
        billingEnabled={false}
      />
    )
  }
  return (
    <Suspense
      fallback={
        <OfferFrame
          {...props}
          catalogue={null}
          context={null}
          canCheckout={canCheckout}
          billingEnabled
        />
      }
    >
      <UpgradeOfferReady {...props} canCheckout={canCheckout} />
    </Suspense>
  )
}

function UpgradeOfferReady(props: UpgradeOfferProps & { canCheckout: boolean }) {
  const { data: catalogue } = useSuspenseQuery(billingQueries.catalogue())
  const { data: context } = useSuspenseQuery(billingQueries.upgradeContext())
  return (
    <OfferFrame
      {...props}
      catalogue={(catalogue ?? null) as BillingCatalogue | null}
      context={(context ?? null) as UpgradeContext | null}
      billingEnabled
    />
  )
}

type OfferFrameProps = UpgradeOfferProps & {
  catalogue: BillingCatalogue | null
  context: UpgradeContext | null
  canCheckout: boolean
  billingEnabled: boolean
}

function OfferFrame(props: OfferFrameProps) {
  const { description, catalogue, context } = props
  const plan = cataloguePlanFor(catalogue, description.requiredPlan)
  const [period, setPeriod] = useState<BillingPeriod>('annual')
  const unlocked = unlockedHighlights(catalogue, context?.currentPlan, description.requiredPlan)
  const trialDays = catalogueTrialDays(catalogue)
  const trialPlanId = trialPlanIdFor(plan, context, catalogue)
  const canManage = props.billingEnabled && props.canCheckout
  const canAct = canManage && Boolean(plan)
  const showFooter = props.billingEnabled || Boolean(props.onDismiss)

  return (
    <div className={cn('w-full text-left', props.className)}>
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        >
          <LockClosedIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-snug tracking-tight">
            {description.headline}
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {plan
              ? upgradeLead(context?.currentPlanName, description.requiredPlanName, {
                  trialActive: context?.trialActive,
                })
              : description.body}
          </p>
        </div>
      </div>

      {unlocked.target.length > 0 ? (
        <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {unlocked.target.map((line) => (
            <li key={line} className="flex items-start gap-2 text-[13px] leading-snug">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <CheckIcon className="size-2.5" />
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {unlocked.included.map((group) => (
        <p key={group.planName} className="mt-3 text-[12px] leading-snug text-muted-foreground">
          <span className="font-medium text-foreground/80">
            Plus everything in {group.planName}:
          </span>{' '}
          {group.highlights.join(' · ')}
        </p>
      ))}

      {plan && props.billingEnabled ? (
        <PriceRow
          plan={plan}
          period={period}
          discountMonths={catalogue?.annualDiscountMonths ?? 2}
          onPeriodChange={setPeriod}
          trialDays={trialPlanId ? trialDays : null}
        />
      ) : null}

      {showFooter ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 text-[13px] text-muted-foreground">
            {canAct ? (
              <a
                href={PLANS_PATH}
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                Compare all plans
                <ArrowTopRightOnSquareIcon className="size-3.5" />
              </a>
            ) : props.billingEnabled && !props.canCheckout ? (
              <span>Only workspace owners can change the plan.</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {props.onDismiss ? (
              <Button type="button" variant="ghost" size="sm" onClick={props.onDismiss}>
                {props.dismissLabel ?? 'Maybe later'}
              </Button>
            ) : null}
            {canManage && plan ? (
              trialPlanId ? (
                <TrialButton
                  planId={trialPlanId}
                  label={`Try ${plan.name} free for ${trialDays} days`}
                />
              ) : (
                <CheckoutButton
                  planId={plan.id}
                  period={period}
                  label={`Upgrade to ${plan.name}`}
                />
              )
            ) : canManage ? (
              <Button asChild size="sm">
                <a href={PLANS_PATH}>View & compare plans</a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The paid plan a first-time trial may be started for, or null when the
 * workspace must convert through checkout instead. Mirrors `billingPlanAction`
 * on Plan & billing so the two surfaces never disagree.
 */
function trialPlanIdFor(
  plan: BillingCatalogue['plans'][number] | null,
  context: UpgradeContext | null,
  catalogue: BillingCatalogue | null
): PaidPlanId | null {
  if (!plan || !context?.trialEligible) return null
  if (plan.id !== 'growth' && plan.id !== 'business' && plan.id !== 'enterprise') return null
  return catalogueTrialedPlanIds(catalogue).includes(plan.id) ? null : plan.id
}

function PriceRow(props: {
  plan: BillingCatalogue['plans'][number]
  period: BillingPeriod
  discountMonths: number
  onPeriodChange: (next: BillingPeriod) => void
  trialDays: number | null
}) {
  const isAnnual = props.period === 'annual'
  const monthlyCents = isAnnual
    ? Math.round(props.plan.priceYearlyCents / 12)
    : props.plan.priceMonthlyCents
  const unit = props.plan.billedPer === 'seat' ? '/seat/mo' : '/mo'

  return (
    <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold tracking-tight tabular-nums">
            {formatUsd(monthlyCents, 0)}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {unit}
            {isAnnual
              ? ` · ${formatUsd(props.plan.priceYearlyCents, 0)} billed yearly`
              : ' · billed monthly'}
          </span>
        </p>
        <PeriodToggle
          value={props.period}
          discountMonths={props.discountMonths}
          savingsLabel={annualSavingsLabel(props.plan)}
          onChange={props.onPeriodChange}
        />
      </div>
      {props.trialDays ? (
        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
          Free for {props.trialDays} days, then the price above. Each paid plan can be tried once;
          when the trial ends you continue on Free with everything you have built.
        </p>
      ) : null}
    </div>
  )
}

function PeriodToggle(props: {
  value: BillingPeriod
  discountMonths: number
  savingsLabel: string | null
  onChange: (next: BillingPeriod) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="inline-flex items-center rounded-full border border-border/50 bg-background p-0.5"
    >
      {(['annual', 'monthly'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={props.value === option}
          onClick={() => props.onChange(option)}
          className={cn(
            'inline-flex h-7 items-center justify-center rounded-full px-2.5 text-[12px] font-medium',
            props.value === option
              ? 'bg-muted text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option === 'annual' ? 'Annual' : 'Monthly'}
          {option === 'annual' && props.savingsLabel ? (
            <span className="ms-1 text-[11px] font-semibold text-primary">
              {props.savingsLabel}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

/** Hands off to the plan configurator with this plan and cycle preselected; payment is the step after. */
function CheckoutButton(props: { planId: string; period: BillingPeriod; label: string }) {
  const href = isPaidPlanId(props.planId)
    ? checkoutPath({ plan: props.planId, period: props.period })
    : PLANS_PATH
  return (
    <Button asChild size="sm">
      <a href={href}>{props.label}</a>
    </Button>
  )
}

/** Starts the trial and lands back on the page that raised the prompt, now unlocked. */
function TrialButton(props: { planId: PaidPlanId; label: string }) {
  const returnTo = useLocation({ select: (location) => location.pathname + location.searchStr })
  return (
    <form method="post" action="/api/billing/trial">
      <input type="hidden" name="planId" value={props.planId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button size="sm" type="submit">
        {props.label}
      </Button>
    </form>
  )
}
