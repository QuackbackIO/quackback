'use client'

import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Clock, CreditCard, Loader2 } from 'lucide-react'

interface TrialProgressProps {
  trialEnd: string
  tier: string
  price: number
  onManageSubscription: () => void
  isLoading: boolean
}

export function BillingTrialProgress({
  trialEnd,
  tier,
  price,
  onManageSubscription,
  isLoading,
}: TrialProgressProps) {
  const trialEndDate = new Date(trialEnd)
  const now = new Date()
  const totalTrialDays = 14
  const msPerDay = 1000 * 60 * 60 * 24

  const daysRemaining = Math.max(0, Math.ceil((trialEndDate.getTime() - now.getTime()) / msPerDay))
  const daysUsed = totalTrialDays - daysRemaining
  const progress = (daysUsed / totalTrialDays) * 100

  const isEndingSoon = daysRemaining <= 3

  return (
    <div className="rounded-xl border border-blue-500/50 bg-blue-500/5 p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10 shrink-0">
          <Clock className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="font-semibold text-blue-600">Trial Period</h2>
            {isEndingSoon && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-500/10 text-amber-600">
                Ending Soon
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            {daysRemaining > 0 ? (
              <>
                <span className="font-medium text-foreground">{daysRemaining} days</span> remaining
                in your trial
              </>
            ) : (
              'Your trial has ended'
            )}
          </p>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
              <span>
                Day {daysUsed} of {totalTrialDays}
              </span>
              <span>
                Ends {trialEndDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            <Progress value={progress} max={100} className="h-2" />
          </div>

          {/* What happens after trial */}
          <div className="rounded-lg bg-card border border-border/50 p-4 mb-4">
            <p className="text-sm font-medium mb-2">After your trial</p>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li className="flex items-center gap-2">
                <CreditCard className="h-3.5 w-3.5" />
                Your card will be charged ${price}/month
              </li>
              <li className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 flex items-center justify-center text-xs">•</span>
                Continue with full {tier} plan features
              </li>
              <li className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 flex items-center justify-center text-xs">•</span>
                Cancel anytime from the customer portal
              </li>
            </ul>
          </div>

          <Button onClick={onManageSubscription} disabled={isLoading} size="sm">
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              'Manage Subscription'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
