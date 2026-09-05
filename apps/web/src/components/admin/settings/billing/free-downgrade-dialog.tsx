import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  beginPlanDowngradeFn,
  billingQueries,
  cancelPlanDowngradeFn,
} from '@/lib/client/queries/billing'
import { checkoutPath, isPaidPlanId, type BillingPeriod } from '@/lib/shared/billing/checkout-path'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { PlanDowngradeIssue } from '@/lib/shared/billing/plan-downgrade'

export type PlanDowngradeCheckout = {
  period: BillingPeriod
  branding?: boolean
}

export function PlanDowngradeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  planName: string
  checkout?: PlanDowngradeCheckout
}) {
  const queryClient = useQueryClient()
  const [issues, setIssues] = useState<PlanDowngradeIssue[]>([])
  const [features, setFeatures] = useState<string[]>([])
  const [resolvedName, setResolvedName] = useState(props.planName)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blocked = issues.length > 0

  useEffect(() => {
    if (!props.open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void beginPlanDowngradeFn({ data: { planId: props.planId } })
      .then((preview) => {
        if (cancelled) return
        setIssues(preview.issues)
        setFeatures(preview.featuresDisabled)
        setResolvedName(preview.planName)
        void queryClient.invalidateQueries({ queryKey: billingQueries.all })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not check this plan')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [props.open, props.planId, queryClient])

  async function keepCurrentPlan() {
    await cancelPlanDowngradeFn()
    await queryClient.invalidateQueries({ queryKey: billingQueries.all })
    props.onOpenChange(false)
  }

  const planName = resolvedName || props.planName
  const confirmLabel = props.planId === 'free' ? 'Switch to Free' : `Continue to ${planName}`

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Action required before downgrading</DialogTitle>
          <DialogDescription>
            Please resolve the following issues before switching to the {planName} plan.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertDescription>
            Switching to {planName} will apply that plan's quotas. Delete extra resources first.
          </AlertDescription>
        </Alert>

        {loading ? (
          <p className="text-sm text-muted-foreground">
            Checking this workspace against {planName}…
          </p>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : blocked ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Issues to resolve ({issues.length}):</p>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {issues.map((issue) => (
                <li key={issue.key} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-sm">{issue.message}</span>
                  <Button size="sm" variant="outline" asChild>
                    <a href={issue.href}>{issue.actionLabel}</a>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This workspace fits the {planName} plan.</p>
        )}

        {features.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Features that will be disabled:</p>
            <ul className="space-y-2 rounded-xl border border-border px-4 py-3">
              {features.map((line) => (
                <li key={line} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-amber-400" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void keepCurrentPlan()}>
            Keep current plan
          </Button>
          {blocked || loading || error ? (
            <Button type="button" disabled>
              Resolve issues first
            </Button>
          ) : props.planId === 'free' ? (
            <form method="post" action="/api/billing/session">
              <input type="hidden" name="action" value="downgrade" />
              <input type="hidden" name="planId" value="free" />
              <Button type="submit" variant="destructive">
                {confirmLabel}
              </Button>
            </form>
          ) : props.checkout && isPaidPlanId(props.planId) ? (
            <form method="post" action="/api/billing/session">
              <input type="hidden" name="action" value="checkout" />
              <input type="hidden" name="planId" value={props.planId} />
              <input type="hidden" name="billingPeriod" value={props.checkout.period} />
              <input type="hidden" name="quantity" value="1" />
              {props.checkout.branding ? (
                <input type="hidden" name="brandingRemoval" value="true" />
              ) : null}
              <Button type="submit">{confirmLabel}</Button>
            </form>
          ) : isPaidPlanId(props.planId) ? (
            <Button type="button" asChild>
              <a href={checkoutPath({ plan: props.planId })}>{confirmLabel}</a>
            </Button>
          ) : (
            <Button type="button" disabled>
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FreeDowngradeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return <PlanDowngradeDialog {...props} planId="free" planName="Free" />
}
