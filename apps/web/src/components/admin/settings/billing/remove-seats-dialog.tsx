import { useEffect, useState } from 'react'
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
import { QuantityStepper } from './quantity-stepper'

export function RemoveSeatsDialog(props: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const overview = useQuery({ ...billingQueries.overview(), enabled: props.open })
  const seats = overview.data?.seats
  const purchased = seats?.purchased ?? 0
  const used = seats?.used ?? 0
  const floor = Math.max(used, 1)
  const [quantity, setQuantity] = useState(purchased)

  useEffect(() => {
    if (props.open && purchased > 0) setQuantity(Math.max(floor, purchased - 1))
  }, [props.open, purchased, floor])

  const canSubmit = quantity >= floor && quantity < purchased

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove seats</DialogTitle>
          <DialogDescription>
            The new quantity takes effect at the end of the billing period. You cannot go below
            seats in use.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Seats after this period</div>
          <QuantityStepper
            value={quantity}
            min={floor}
            max={purchased}
            onChange={setQuantity}
            decreaseLabel="Fewer seats"
            increaseLabel="More seats"
          />
        </div>
        <p className="text-[12px] text-muted-foreground">
          {used} {used === 1 ? 'seat is' : 'seats are'} in use. Unused seats stay until the period
          ends.
        </p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <form method="post" action="/api/billing/session">
            <input type="hidden" name="action" value="seats" />
            <input type="hidden" name="quantity" value={String(quantity)} />
            <Button type="submit" disabled={!canSubmit}>
              Schedule removal
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
