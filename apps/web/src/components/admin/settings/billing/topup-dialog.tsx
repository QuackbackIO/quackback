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

export function TopUpDialog(props: {
  open: boolean
  meter: 'ai' | 'email' | null
  onOpenChange: (open: boolean) => void
}) {
  const [packs, setPacks] = useState(1)
  const catalogue = useQuery({ ...billingQueries.catalogue(), enabled: props.open })
  const packCents =
    props.meter === 'email' ? catalogue.data?.emailTopUpPackCents : catalogue.data?.aiTopUpPackCents
  const packUnits = props.meter === 'email' ? catalogue.data?.emailTopUpPackUnits : null
  const cents = typeof packCents === 'number' ? packCents : 1000
  const total = cents * packs
  const title = props.meter === 'email' ? 'Top up emails' : 'Top up AI usage'
  const unitHint =
    props.meter === 'email' && packUnits
      ? `${packUnits.toLocaleString()} emails per pack`
      : 'Credit carries over until it is used.'

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {formatUsd(cents, 0)} per pack. {unitHint}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Packs</div>
          <QuantityStepper
            value={packs}
            min={1}
            onChange={setPacks}
            decreaseLabel="Fewer packs"
            increaseLabel="More packs"
          />
        </div>
        <div className="flex items-baseline justify-between gap-3 rounded-[10px] border border-border/50 bg-muted/30 px-4 py-3 text-[13px]">
          <span className="text-muted-foreground">
            {packs} × {formatUsd(cents, 0)}
          </span>
          <span className="font-medium tabular-nums">{formatUsd(total, 2)}</span>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <form method="post" action="/api/billing/session">
            <input type="hidden" name="action" value="topup" />
            <input type="hidden" name="meter" value={props.meter ?? 'ai'} />
            <input type="hidden" name="packs" value={String(packs)} />
            <Button type="submit" disabled={!props.meter}>
              Continue to checkout
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
