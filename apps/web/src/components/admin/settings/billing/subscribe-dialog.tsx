import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatUsd } from '@/lib/shared/format-usd'
import { annualSavingsLabel } from '@/lib/shared/billing/checkout-path'
import { cn } from '@/lib/shared/utils'
import type { BillingCatalogue } from '@/lib/server/control-plane/client'
import { QuantityStepper } from './quantity-stepper'

export function SubscribeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: BillingCatalogue['plans'][number]
  endsTrial: boolean
  minSeats: number
  discountMonths: number
  period: 'monthly' | 'annual'
}) {
  const billedPerSeat = props.plan.billedPer === 'seat'
  const [period, setPeriod] = useState<'monthly' | 'annual'>(props.period)
  const [seats, setSeats] = useState(() => Math.max(props.minSeats, 1))
  const quantity = billedPerSeat ? Math.max(seats, props.minSeats, 1) : 1
  const isAnnual = period === 'annual'
  const unitCents = isAnnual ? props.plan.priceYearlyCents : props.plan.priceMonthlyCents
  const dueCents = billedPerSeat ? quantity * unitCents : unitCents
  const monthlyCents = isAnnual
    ? Math.round(props.plan.priceYearlyCents / 12)
    : props.plan.priceMonthlyCents
  const savingsLabel = annualSavingsLabel(props.plan)

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Subscribe to {props.plan.name}</DialogTitle>
          <DialogDescription>
            {billedPerSeat
              ? `${formatUsd(monthlyCents, 0)}/seat/${isAnnual ? 'mo billed yearly' : 'mo'}.`
              : `${formatUsd(monthlyCents, 0)}/${isAnnual ? 'mo billed yearly' : 'mo'}.`}
          </DialogDescription>
        </DialogHeader>

        <div
          role="radiogroup"
          aria-label="Billing period"
          className="inline-flex items-center rounded-full border border-border/50 bg-muted/30 p-0.5"
        >
          {(['annual', 'monthly'] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={period === option}
              onClick={() => setPeriod(option)}
              className={cn(
                'inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium',
                period === option
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {option === 'annual' ? 'Annual' : 'Monthly'}
              {option === 'annual' && savingsLabel ? (
                <span className="ms-1.5 text-[11px] font-semibold text-primary">
                  {savingsLabel}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {billedPerSeat ? (
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Seats</div>
            <QuantityStepper
              value={quantity}
              min={Math.max(props.minSeats, 1)}
              onChange={setSeats}
              decreaseLabel="Fewer seats"
              increaseLabel="More seats"
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2 rounded-[10px] border border-border/50 bg-muted/30 px-4 py-3">
          {billedPerSeat ? (
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-muted-foreground">
                {quantity} {quantity === 1 ? 'seat' : 'seats'} × {formatUsd(unitCents, 0)}
                {isAnnual ? '/seat/yr' : '/seat/mo'}
              </span>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-3 text-[13px] font-medium">
            <span>Due today</span>
            <span className="tabular-nums">{formatUsd(dueCents, 2)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <form method="post" action="/api/billing/session">
            <input type="hidden" name="action" value="checkout" />
            <input type="hidden" name="planId" value={props.plan.id} />
            <input type="hidden" name="billingPeriod" value={period} />
            <input type="hidden" name="quantity" value={String(quantity)} />
            <Button type="submit">Continue to checkout</Button>
          </form>
        </DialogFooter>
        <p className="text-[12px] text-muted-foreground">
          {props.endsTrial
            ? 'Payment is handled by Stripe. Billing starts today and your trial ends when it goes through.'
            : 'Payment is handled by Stripe.'}
        </p>
      </DialogContent>
    </Dialog>
  )
}
