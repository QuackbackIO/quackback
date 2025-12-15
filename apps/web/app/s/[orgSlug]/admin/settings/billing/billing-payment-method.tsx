'use client'

import { Button } from '@/components/ui/button'
import { CreditCard, Loader2 } from 'lucide-react'

interface PaymentMethodProps {
  card: {
    brand: string
    last4: string
    expMonth: number
    expYear: number
  } | null
  onManage: () => void
  isLoading: boolean
}

function getCardBrandDisplay(brand: string): string {
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'American Express',
    discover: 'Discover',
    diners: 'Diners Club',
    jcb: 'JCB',
    unionpay: 'UnionPay',
  }
  return brands[brand.toLowerCase()] || brand
}

export function BillingPaymentMethod({ card, onManage, isLoading }: PaymentMethodProps) {
  if (!card) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <CreditCard className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h2 className="font-medium">Payment Method</h2>
              <p className="text-sm text-muted-foreground">No payment method on file</p>
            </div>
          </div>
          <Button onClick={onManage} disabled={isLoading} variant="outline" size="sm">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              'Add Payment Method'
            )}
          </Button>
        </div>
      </div>
    )
  }

  const expiry = `${card.expMonth.toString().padStart(2, '0')}/${card.expYear.toString().slice(-2)}`

  return (
    <div className="rounded-xl border border-border/50 bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-medium">Payment Method</h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{getCardBrandDisplay(card.brand)}</span>
              <span>••••</span>
              <span>{card.last4}</span>
              <span className="text-muted-foreground/60">|</span>
              <span>Expires {expiry}</span>
            </div>
          </div>
        </div>
        <Button onClick={onManage} disabled={isLoading} variant="outline" size="sm">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            'Update'
          )}
        </Button>
      </div>
    </div>
  )
}
