import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { billingQueries } from '@/lib/client/queries/billing'
import { formatUsd } from '@/lib/shared/format-usd'
import { QuantityStepper } from './quantity-stepper'

export function AddSeatsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [addCount, setAddCount] = useState(1)
  const overview = useQuery({ ...billingQueries.overview(), enabled: props.open })
  const catalogue = useQuery({ ...billingQueries.catalogue(), enabled: props.open })
  const seats = overview.data?.seats
  const purchased = seats?.purchased ?? 0
  const nextQuantity = purchased + addCount
  const plan = catalogue.data?.plans.find((entry) => entry.id === overview.data?.plan)
  const perSeatMonth = plan != null ? Math.round(plan.priceYearlyCents / 12) : 0
  const addedYearly = plan != null ? addCount * plan.priceYearlyCents : 0
  const newYearly = plan != null ? nextQuantity * plan.priceYearlyCents : 0
  const preview = useQuery({
    ...billingQueries.seatsPreview(nextQuantity),
    enabled: props.open && nextQuantity > purchased,
  })

  function formatDate(iso: string): string {
    const date = new Date(iso)
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add seats</DialogTitle>
          {plan ? (
            <DialogDescription>
              Your {plan.name} plan is {formatUsd(perSeatMonth, 0)}/seat/mo.
            </DialogDescription>
          ) : (
            <DialogDescription>Add seats to this workspace.</DialogDescription>
          )}
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Seats to add</div>
          <QuantityStepper
            value={addCount}
            min={1}
            onChange={setAddCount}
            decreaseLabel="Fewer seats"
            increaseLabel="More seats"
          />
        </div>
        {plan ? (
          <div className="flex flex-col gap-2 rounded-[10px] border border-border/50 bg-muted/30 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-muted-foreground">
                {addCount} {addCount === 1 ? 'seat' : 'seats'} × {formatUsd(perSeatMonth, 0)}
                /seat/mo
              </span>
              <span className="tabular-nums">{formatUsd(addedYearly, 2)}/yr</span>
            </div>
            {preview.data?.amountDueCents != null ? (
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-muted-foreground">
                  Due today
                  {preview.data.periodEnd
                    ? `, prorated to ${formatDate(preview.data.periodEnd)}`
                    : ''}
                </span>
                <span className="tabular-nums">{formatUsd(preview.data.amountDueCents, 2)}</span>
              </div>
            ) : null}
            <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-border/50 pt-2.5 text-[13px] font-medium">
              <span>New total · {nextQuantity} seats</span>
              <span className="tabular-nums">{formatUsd(newYearly, 2)}/yr</span>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <form method="post" action="/api/billing/session">
            <input type="hidden" name="action" value="seats" />
            <input type="hidden" name="quantity" value={String(nextQuantity)} />
            <Button type="submit" disabled={purchased < 1}>
              Continue to checkout
            </Button>
          </form>
        </DialogFooter>
        <p className="text-[12px] text-muted-foreground">
          Payment is handled by Stripe. New seats are available immediately.
        </p>
      </DialogContent>
    </Dialog>
  )
}
