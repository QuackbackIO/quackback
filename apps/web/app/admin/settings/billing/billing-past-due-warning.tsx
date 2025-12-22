'use client'

import { Button } from '@/components/ui/button'
import { AlertTriangle, Loader2 } from 'lucide-react'

interface PastDueWarningProps {
  currentPeriodEnd: string
  onUpdatePayment: () => void
  isLoading: boolean
}

export function BillingPastDueWarning({
  currentPeriodEnd,
  onUpdatePayment,
  isLoading,
}: PastDueWarningProps) {
  const endDate = new Date(currentPeriodEnd)
  const now = new Date()
  const msPerDay = 1000 * 60 * 60 * 24
  const daysUntilInterruption = Math.max(
    0,
    Math.ceil((endDate.getTime() - now.getTime()) / msPerDay)
  )

  return (
    <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/20 shrink-0">
          <AlertTriangle className="h-5 w-5 text-red-600" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-red-600 mb-1">Payment Failed</h2>
          <p className="text-sm text-red-600/90 mb-4">
            We were unable to process your payment. Please update your payment method to avoid
            service interruption.
          </p>

          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 mb-4">
            <p className="text-sm font-medium text-red-600">
              {daysUntilInterruption > 0 ? (
                <>
                  Service will be interrupted in{' '}
                  <span className="font-bold">{daysUntilInterruption} days</span> (
                  {endDate.toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  )
                </>
              ) : (
                'Service interruption is imminent. Please update your payment method now.'
              )}
            </p>
          </div>

          <Button onClick={onUpdatePayment} disabled={isLoading} variant="destructive">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              'Update Payment Method'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
