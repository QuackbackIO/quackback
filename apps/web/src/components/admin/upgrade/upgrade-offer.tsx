import { Suspense, useState } from 'react'
import { CheckIcon } from '@heroicons/react/24/solid'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useRouteContext } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { billingQueries } from '@/lib/client/queries/billing'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { formatUsd } from '@/lib/shared/format-usd'
import { cataloguePlanFor, type UpgradeDescription } from '@/lib/shared/describe-upgrade'
import { cn } from '@/lib/shared/utils'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'

type BillingPeriod = 'monthly' | 'annual'

type UpgradeOfferProps = {
  description: UpgradeDescription
  dismissLabel?: string
  onDismiss?: () => void
  className?: string
}

/**
 * The one upgrade body. Card, in-route screen, and modal all render this.
 * Plan name, price, and highlights come from the same catalogue as Plan & billing.
 * The catalogue is prefetched in the route loader so the first paint is complete.
 */
export function UpgradeOffer(props: UpgradeOfferProps) {
  const { billingEnabled } = useRouteContext({ from: '__root__' })
  const canCheckout = usePermission(PERMISSIONS.BILLING_MANAGE)
  if (!billingEnabled) {
    return <OfferFrame {...props} catalogue={null} canCheckout={false} billingEnabled={false} />
  }
  return (
    <Suspense
      fallback={<OfferFrame {...props} catalogue={null} canCheckout={canCheckout} billingEnabled />}
    >
      <UpgradeOfferReady {...props} canCheckout={canCheckout} />
    </Suspense>
  )
}

function UpgradeOfferReady(
  props: UpgradeOfferProps & {
    canCheckout: boolean
  }
) {
  const { data: catalogue } = useSuspenseQuery(billingQueries.catalogue())
  return (
    <OfferFrame
      {...props}
      catalogue={(catalogue ?? null) as BillingCatalogue | null}
      billingEnabled
    />
  )
}

function OfferFrame(
  props: UpgradeOfferProps & {
    catalogue: BillingCatalogue | null
    canCheckout: boolean
    billingEnabled: boolean
  }
) {
  const plan = cataloguePlanFor(props.catalogue, props.description.requiredPlan)
  const [period, setPeriod] = useState<BillingPeriod>('annual')

  return (
    <div className={cn('mx-auto w-full max-w-md text-center', props.className)}>
      <h2 className="text-lg font-semibold tracking-tight">{props.description.headline}</h2>
      <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
        {props.description.body}
      </p>
      {plan ? (
        <CatalogueDetails
          plan={plan}
          period={period}
          discountMonths={props.catalogue?.annualDiscountMonths ?? 2}
          onPeriodChange={setPeriod}
        />
      ) : null}
      <div className="mt-5 flex flex-col items-center gap-2">
        {plan && props.canCheckout && props.billingEnabled ? (
          <CheckoutButton planId={plan.id} period={period} label={`Upgrade to ${plan.name}`} />
        ) : props.billingEnabled ? (
          <Button asChild size="sm">
            <a href="/admin/settings/billing">See plans</a>
          </Button>
        ) : null}
        {props.onDismiss ? (
          <Button type="button" variant="outline" size="sm" onClick={props.onDismiss}>
            {props.dismissLabel ?? 'Maybe later'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CatalogueDetails(props: {
  plan: BillingCatalogue['plans'][number]
  period: BillingPeriod
  discountMonths: number
  onPeriodChange: (next: BillingPeriod) => void
}) {
  const isAnnual = props.period === 'annual'
  const monthlyCents = isAnnual
    ? Math.round(props.plan.priceYearlyCents / 12)
    : props.plan.priceMonthlyCents
  const unit = props.plan.billedPer === 'seat' ? '/seat/mo' : '/mo'

  return (
    <div className="mt-5 text-left">
      <p className="text-[13px] text-muted-foreground">{props.plan.bestFor}</p>
      <p className="mt-3 flex items-baseline justify-center gap-1">
        <span className="text-[28px] font-semibold tracking-tight tabular-nums">
          {formatUsd(monthlyCents, 0)}
        </span>
        <span className="text-[13px] text-muted-foreground">{unit}</span>
      </p>
      {props.plan.id !== 'free' ? (
        <p className="mt-1 text-center text-[12px] text-muted-foreground">
          {isAnnual
            ? `${formatUsd(props.plan.priceYearlyCents, 0)} billed yearly`
            : 'billed monthly'}
        </p>
      ) : null}
      <PeriodToggle
        value={props.period}
        discountMonths={props.discountMonths}
        onChange={props.onPeriodChange}
      />
      <ul className="mt-4 space-y-2">
        {props.plan.highlights.map((line) => (
          <li key={line} className="flex items-start gap-2 text-[13px] leading-snug">
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PeriodToggle(props: {
  value: BillingPeriod
  discountMonths: number
  onChange: (next: BillingPeriod) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing period"
      className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-border/50 bg-muted/30 p-0.5"
    >
      {(['annual', 'monthly'] as const).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={props.value === option}
          onClick={() => props.onChange(option)}
          className={cn(
            'inline-flex h-8 flex-1 items-center justify-center rounded-full px-3 text-[13px] font-medium',
            props.value === option
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option === 'annual' ? 'Annual' : 'Monthly'}
          {option === 'annual' ? (
            <span className="ms-1.5 text-[11px] font-semibold text-primary">
              {props.discountMonths} mo free
            </span>
          ) : null}
        </button>
      ))}
    </div>
  )
}

function CheckoutButton(props: { planId: string; period: BillingPeriod; label: string }) {
  return (
    <form method="post" action="/api/billing/session" className="w-full">
      <input type="hidden" name="action" value="checkout" />
      <input type="hidden" name="planId" value={props.planId} />
      <input type="hidden" name="billingPeriod" value={props.period} />
      <Button size="sm" type="submit" className="w-full">
        {props.label}
      </Button>
    </form>
  )
}
