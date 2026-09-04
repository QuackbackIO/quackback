import { useState } from 'react'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/solid'
import type { BillingProjectionOverview } from '@/lib/server/domains/billing/projection-overview'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { cn } from '@/lib/shared/utils'
import { formatUsd } from '@/lib/shared/format-usd'
import {
  billingPlanAction,
  catalogueTrialDays,
  catalogueTrialedPlanIds,
  type BillingPlanAction,
  type PaidPlanId,
} from '@/lib/shared/billing/plan-action'
import {
  annualSavingsLabel,
  checkoutSummary,
  isPaidPlanId,
  type BillingPeriod,
} from '@/lib/shared/billing/checkout-path'
import { QuantityStepper } from './quantity-stepper'
import { FreeDowngradeDialog } from './free-downgrade-dialog'

type CataloguePlan = BillingCatalogue['plans'][number]

export type CheckoutSelection = {
  plan: PaidPlanId | null
  period: BillingPeriod
  seats: number
  /** Branding removal added to the order. */
  branding: boolean
}

/** A change never clears the plan, so deep links stay meaningful across edits. */
export type CheckoutSelectionChange = Partial<{
  plan: PaidPlanId
  period: BillingPeriod
  seats: number
  branding: boolean
}>

const PLANS_PATH = '/admin/settings/billing'
const COMPARE_FEATURES_HREF = 'https://quackback.io/pricing'

/**
 * The plan configurator: billing cycle, plan, seats and add-ons on the left,
 * a live order summary on the right, then one hand-off to hosted checkout.
 * Selection lives in the URL so an upgrade prompt can deep-link with the plan
 * preselected and a refresh keeps the choice.
 */
export function CheckoutBuilder(props: {
  overview: BillingProjectionOverview
  catalogue: BillingCatalogue
  selection: CheckoutSelection
  onChange: (next: CheckoutSelectionChange) => void
}) {
  const { overview, catalogue, selection } = props
  const paidPlans = catalogue.plans
    .filter((plan) => isPaidPlanId(plan.id))
    .sort((a, b) => a.rank - b.rank)
  const freePlan = catalogue.plans.find((plan) => plan.id === 'free') ?? null
  const selectedPlan = paidPlans.find((plan) => plan.id === selection.plan) ?? null
  const minSeats = Math.max(overview.seats?.used ?? 1, 1)
  const seats = Math.max(selection.seats, minSeats)
  const trialedPlanIds = catalogueTrialedPlanIds(catalogue)
  const trialDays = catalogueTrialDays(catalogue)
  const savingsReference =
    selectedPlan ?? paidPlans.find((plan) => plan.recommended) ?? paidPlans[0]
  const savings = annualSavingsLabel(savingsReference)
  const freeAction = freePlan ? billingPlanAction('free', overview, trialedPlanIds) : null
  const canPurchase = overview.canUpgrade || overview.canManageBilling
  const branding = catalogue.brandingRemoval ?? null
  const brandingInOrder = Boolean(
    branding && selection.branding && !overview.hideBranding && canPurchase
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="space-y-8">
        <section className="space-y-3">
          <SectionTitle>Billing cycle</SectionTitle>
          <CycleToggle
            value={selection.period}
            savingsLabel={savings}
            discountMonths={catalogue.annualDiscountMonths}
            onChange={(period) => props.onChange({ period })}
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <SectionTitle>Plan</SectionTitle>
            <a
              href={PLANS_PATH}
              className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground hover:underline"
            >
              Compare all plans
              <ArrowTopRightOnSquareIcon className="size-3.5" />
            </a>
          </div>
          <div
            role="radiogroup"
            aria-label="Plan"
            className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50 bg-card"
          >
            {freePlan && freeAction ? <FreePlanRow plan={freePlan} action={freeAction} /> : null}
            {paidPlans.map((plan) => (
              <PlanRow
                key={plan.id}
                plan={plan}
                period={selection.period}
                selected={plan.id === selection.plan}
                action={billingPlanAction(plan.id, overview, trialedPlanIds)}
                trialActive={overview.trialActive && overview.plan === plan.id}
                onSelect={() => props.onChange({ plan: plan.id as PaidPlanId })}
              />
            ))}
          </div>
        </section>

        {selectedPlan?.billedPer === 'seat' ? (
          <section className="space-y-3">
            <SectionTitle>Seats</SectionTitle>
            <div className="rounded-xl border border-border/50 bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <QuantityStepper
                  value={seats}
                  min={minSeats}
                  onChange={(next) => props.onChange({ seats: next })}
                  decreaseLabel="Fewer seats"
                  increaseLabel="More seats"
                />
                <span className="text-[13px] text-muted-foreground">
                  {seats === 1 ? 'seat' : 'seats'} (min. {minSeats} — already in use)
                </span>
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Each member or pending invite uses a seat. You have {overview.seats?.members ?? 0}{' '}
                {(overview.seats?.members ?? 0) === 1 ? 'member' : 'members'} and{' '}
                {overview.seats?.pending ?? 0} pending{' '}
                {(overview.seats?.pending ?? 0) === 1 ? 'invite' : 'invites'}.
              </p>
            </div>
          </section>
        ) : null}

        {branding ? (
          <section className="space-y-3">
            <SectionTitle>Add-ons</SectionTitle>
            <BrandingAddOnRow
              price={branding}
              period={selection.period}
              hideBranding={overview.hideBranding}
              canPurchase={canPurchase}
              checked={brandingInOrder}
              onCheckedChange={(next) => props.onChange({ branding: next })}
            />
          </section>
        ) : null}
      </div>

      <OrderSummary
        overview={overview}
        plan={selectedPlan}
        period={selection.period}
        seats={seats}
        branding={brandingInOrder && branding ? branding : null}
        trialDays={trialDays}
        currentPlanRank={catalogue.plans.find((plan) => plan.id === overview.plan)?.rank ?? 0}
        action={selectedPlan ? billingPlanAction(selectedPlan.id, overview, trialedPlanIds) : null}
      />
    </div>
  )
}

function SectionTitle(props: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold">{props.children}</h2>
}

function CycleToggle(props: {
  value: BillingPeriod
  savingsLabel: string | null
  discountMonths: number
  onChange: (next: BillingPeriod) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing cycle"
      className="inline-flex items-center rounded-lg border border-border/50 bg-muted/30 p-1"
    >
      {(['monthly', 'annual'] as const).map((option) => {
        const active = props.value === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => props.onChange(option)}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option === 'annual' ? 'Yearly' : 'Monthly'}
            {option === 'annual' && props.savingsLabel ? (
              <Badge size="sm" shape="pill" variant={active ? 'default' : 'secondary'}>
                {props.savingsLabel}
              </Badge>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function PlanRow(props: {
  plan: CataloguePlan
  period: BillingPeriod
  selected: boolean
  action: BillingPlanAction
  trialActive: boolean
  onSelect: () => void
}) {
  const { plan, period } = props
  const monthlyCents =
    period === 'annual' ? Math.round(plan.priceYearlyCents / 12) : plan.priceMonthlyCents
  const unit = plan.billedPer === 'seat' ? '/seat/mo' : '/mo'
  const current = props.action.kind === 'current'
  return (
    <div
      role="radio"
      aria-checked={props.selected}
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onSelect()
        }
      }}
      className={cn(
        'cursor-pointer px-5 py-4 outline-none transition-colors focus-visible:bg-muted/40',
        props.selected ? 'bg-primary/5 ring-1 ring-inset ring-primary/40' : 'hover:bg-muted/30'
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold">{plan.name}</h3>
            {current ? (
              <Badge size="sm" shape="pill">
                {props.trialActive ? 'Current · trial' : 'Current'}
              </Badge>
            ) : plan.recommended ? (
              <Badge size="sm" shape="pill" variant="secondary">
                Recommended
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{plan.bestFor}</p>
          <a
            href={COMPARE_FEATURES_HREF}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            View & compare features
            <ArrowTopRightOnSquareIcon className="size-3.5" />
          </a>
        </div>
        <p className="shrink-0 text-right">
          <span className="text-lg font-semibold tracking-tight tabular-nums">
            {formatUsd(monthlyCents, 0)}
          </span>
          <span className="block text-[12px] text-muted-foreground">
            {unit}
            {period === 'annual' ? ', billed yearly' : ''}
          </span>
        </p>
      </div>
    </div>
  )
}

function FreePlanRow(props: { plan: CataloguePlan; action: BillingPlanAction }) {
  const [open, setOpen] = useState(false)
  const current = props.action.kind === 'current'
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="text-sm font-semibold">{props.plan.name}</h3>
          {current ? (
            <Badge size="sm" shape="pill">
              Current
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">{props.plan.bestFor}</p>
        <a
          href={COMPARE_FEATURES_HREF}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
        >
          View & compare features
          <ArrowTopRightOnSquareIcon className="size-3.5" />
        </a>
        {props.action.kind === 'downgrade' ? (
          <div className="mt-3">
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
              Switch to Free
            </Button>
            {open ? <FreeDowngradeDialog open onOpenChange={setOpen} /> : null}
          </div>
        ) : null}
      </div>
      <p className="shrink-0 text-right">
        <span className="text-lg font-semibold tracking-tight tabular-nums">$0</span>
        <span className="block text-[12px] text-muted-foreground">forever</span>
      </p>
    </div>
  )
}

type BrandingPrice = NonNullable<BillingCatalogue['brandingRemoval']>

function brandingCents(price: BrandingPrice, period: BillingPeriod): number {
  return period === 'annual' ? price.annualCents : price.monthlyCents
}

function BrandingAddOnRow(props: {
  price: BrandingPrice
  period: BillingPeriod
  hideBranding: boolean
  canPurchase: boolean
  checked: boolean
  onCheckedChange: (next: boolean) => void
}) {
  const intervalLabel = props.period === 'annual' ? 'yr' : 'mo'
  const price = `${formatUsd(brandingCents(props.price, props.period), 0)}/${intervalLabel}`
  const selectable = !props.hideBranding && props.canPurchase
  return (
    <label
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card px-4 py-3',
        selectable && 'cursor-pointer',
        props.checked && 'bg-primary/5 ring-1 ring-inset ring-primary/40'
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {selectable ? (
          <Checkbox
            className="mt-0.5"
            checked={props.checked}
            onCheckedChange={(value) => props.onCheckedChange(value === true)}
            aria-label="Add branding removal to the order"
          />
        ) : null}
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Remove Quackback branding</div>
          <div className="text-[12px] text-muted-foreground">
            Hide &quot;Powered by Quackback&quot; on the portal, widget, and emails. Billed with
            your plan on the same {props.period === 'annual' ? 'yearly' : 'monthly'} cycle.
          </div>
        </div>
      </div>
      {props.hideBranding ? (
        <Badge size="sm" shape="pill" variant="secondary">
          Included
        </Badge>
      ) : (
        <span className="shrink-0 text-[13px] font-medium tabular-nums">{price}</span>
      )}
    </label>
  )
}

function OrderSummary(props: {
  overview: BillingProjectionOverview
  plan: CataloguePlan | null
  period: BillingPeriod
  seats: number
  branding: BrandingPrice | null
  trialDays: number
  currentPlanRank: number
  action: BillingPlanAction | null
}) {
  const { overview, plan, period } = props
  const canAct = overview.canUpgrade || overview.canManageBilling
  const summary = plan ? checkoutSummary(plan, period, props.seats) : null
  const intervalLabel = period === 'annual' ? 'year' : 'mo'
  const fromPaid = overview.plan !== 'free' && !overview.trialActive
  const movingDown = plan != null && fromPaid && plan.rank < props.currentPlanRank
  // A plan the workspace is already on (or none at all) is not charged, which
  // leaves branding removal as the only purchasable line.
  const planCharged = summary != null && props.action?.kind !== 'current'
  const brandingOnly = props.branding != null && !planCharged
  const addOnCents = props.branding ? brandingCents(props.branding, period) : 0
  const totalCents = (planCharged ? summary.totalCents : 0) + addOnCents
  const hasOrder = summary != null || props.branding != null

  return (
    <aside className="lg:sticky lg:top-6">
      <div className="overflow-hidden rounded-xl border border-border/50 bg-card">
        <div className="border-b border-border/50 px-5 py-4">
          <h2 className="text-sm font-semibold">Order summary</h2>
        </div>
        {hasOrder ? (
          <div className="space-y-4 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">
                {plan ? `${plan.name} plan` : 'Add-ons only'}
              </span>
              <Badge size="sm" shape="pill" variant="secondary">
                {period === 'annual' ? 'Yearly' : 'Monthly'}
              </Badge>
            </div>
            <div className="space-y-2 text-[13px]">
              {plan && summary && planCharged ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">
                    {summary.billedPer === 'seat'
                      ? `${summary.quantity} ${summary.quantity === 1 ? 'seat' : 'seats'} × ${formatUsd(summary.unitCents, 0)}/${intervalLabel}`
                      : `Workspace × ${formatUsd(summary.unitCents, 0)}/${intervalLabel}`}
                  </span>
                  <span className="tabular-nums">
                    {formatUsd(summary.totalCents, 0)}/{intervalLabel}
                  </span>
                </div>
              ) : null}
              {props.branding ? (
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-muted-foreground">Remove branding</span>
                  <span className="tabular-nums">
                    {formatUsd(addOnCents, 0)}/{intervalLabel}
                  </span>
                </div>
              ) : null}
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border/50 pt-3">
              <span className="text-sm font-medium">Total</span>
              <span className="text-lg font-semibold tracking-tight tabular-nums">
                {formatUsd(totalCents, 0)}/{intervalLabel}
              </span>
            </div>
            {period === 'annual' ? (
              <div className="flex items-baseline justify-between gap-3 text-[12px] text-muted-foreground">
                <span>Monthly equivalent</span>
                <span className="tabular-nums">{formatUsd(Math.round(totalCents / 12), 0)}/mo</span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="px-5 py-4 text-[13px] text-muted-foreground">
            Pick a plan to see your total.
          </p>
        )}
        <div className="space-y-3 border-t border-border/50 px-5 py-4">
          <SummaryAction
            plan={plan}
            period={period}
            quantity={summary?.quantity ?? 1}
            branding={props.branding != null}
            brandingOnly={brandingOnly}
            action={props.action}
            canAct={canAct}
            trialDays={props.trialDays}
          />
          <p className="text-[12px] leading-snug text-muted-foreground">
            {!canAct
              ? 'Only workspace owners can change the plan.'
              : brandingOnly
                ? plan
                  ? 'You are already on this plan; only the add-on is charged, pro-rata on your current subscription.'
                  : 'Payment is handled by Stripe. Branding removal renews on its own cycle until you cancel it.'
                : props.action?.kind === 'current'
                  ? 'You are already on this plan. Seats can be changed from Plans & billing.'
                  : overview.trialActive
                    ? 'Payment is handled by Stripe. Billing starts today and your trial ends when it goes through.'
                    : movingDown
                      ? 'Payment is handled by Stripe. Moving to a lower plan takes effect at the end of the current period.'
                      : fromPaid
                        ? 'Payment is handled by Stripe. Moving up applies now, billed pro-rata.'
                        : 'Payment is handled by Stripe.'}
          </p>
        </div>
      </div>
    </aside>
  )
}

function SummaryAction(props: {
  plan: CataloguePlan | null
  period: BillingPeriod
  quantity: number
  branding: boolean
  brandingOnly: boolean
  action: BillingPlanAction | null
  canAct: boolean
  trialDays: number
}) {
  const { plan, action } = props
  if (props.brandingOnly && props.canAct) {
    return (
      <form method="post" action="/api/billing/session">
        <input type="hidden" name="action" value="branding" />
        <input type="hidden" name="billingPeriod" value={props.period} />
        <Button type="submit" className="w-full">
          Continue to payment
        </Button>
      </form>
    )
  }
  if (!plan || !action || !isPaidPlanId(plan.id)) {
    return (
      <Button type="button" className="w-full" disabled>
        Continue to payment
      </Button>
    )
  }
  if (action.kind === 'current') {
    return (
      <Button type="button" className="w-full" variant="outline" disabled>
        Current plan
      </Button>
    )
  }
  if (!props.canAct || action.kind === 'unavailable' || action.kind === 'downgrade') {
    return (
      <Button type="button" className="w-full" disabled>
        Continue to payment
      </Button>
    )
  }
  return (
    <div className="space-y-2">
      <form method="post" action="/api/billing/session">
        <input type="hidden" name="action" value="checkout" />
        <input type="hidden" name="planId" value={plan.id} />
        <input type="hidden" name="billingPeriod" value={props.period} />
        <input type="hidden" name="quantity" value={String(props.quantity)} />
        {props.branding ? <input type="hidden" name="brandingRemoval" value="true" /> : null}
        <Button type="submit" className="w-full">
          Continue to payment
        </Button>
      </form>
      {action.kind === 'trial' ? (
        <TrialInstead planId={action.planId} planName={plan.name} trialDays={props.trialDays} />
      ) : null}
    </div>
  )
}

function TrialInstead(props: { planId: PaidPlanId; planName: string; trialDays: number }) {
  const [open, setOpen] = useState(false)
  const formId = `checkout-trial-${props.planId}`
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full"
        onClick={() => setOpen(true)}
      >
        Or try {props.planName} free for {props.trialDays} days
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Try ${props.planName} for ${props.trialDays} days?`}
        description={`You’ll have ${props.planName} for ${props.trialDays} days. When it ends you continue on Free with everything you have built. Each paid plan can be tried once.`}
        confirmLabel={`Start ${props.planName} trial`}
        onConfirm={() => {
          const form = document.getElementById(formId) as HTMLFormElement | null
          form?.requestSubmit()
        }}
      />
      <form id={formId} method="post" action="/api/billing/trial" className="hidden">
        <input type="hidden" name="planId" value={props.planId} />
      </form>
    </>
  )
}
