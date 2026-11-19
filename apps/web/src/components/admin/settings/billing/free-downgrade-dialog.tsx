import { useEffect, useState } from 'react'
import { fetchDowngradePreviewFn } from '@/lib/client/queries/billing'
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
import type { PlanCapInfo, PlanDowngradeIssue } from '@/lib/shared/billing/plan-downgrade'
import { errorText } from '@/lib/client/error-text'

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
  /** The way out. An ended trial has no current plan to keep, so it goes back to the plans. */
  cancelLabel?: string
}) {
  const [issues, setIssues] = useState<PlanDowngradeIssue[]>([])
  const [info, setInfo] = useState<PlanCapInfo[]>([])
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
    void fetchDowngradePreviewFn({ data: { planId: props.planId } })
      .then((preview) => {
        if (cancelled) return
        setIssues(preview.issues)
        setInfo(preview.info)
        setFeatures(preview.featuresDisabled)
        setResolvedName(preview.planName)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(errorText(err, 'Could not check this plan'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [props.open, props.planId])

  const planName = resolvedName || props.planName
  const confirmLabel = props.planId === 'free' ? 'Switch to Free' : `Continue to ${planName}`

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Switch to {planName}</DialogTitle>
          <DialogDescription>
            {blocked
              ? `Resolve these first: ${planName} applies its own limits.`
              : `Check what changes on ${planName}, then confirm.`}
          </DialogDescription>
        </DialogHeader>

        {blocked ? (
          <Alert>
            <AlertDescription>
              Switching to {planName} will apply that plan's quotas. Delete extra resources first.
            </AlertDescription>
          </Alert>
        ) : null}

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

        {!loading && !error && info.length > 0 ? (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {info.map((row) => (
              <li key={row.key}>{row.message}. Existing ones stay; new ones stop at the cap.</li>
            ))}
          </ul>
        ) : null}

        {features.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">Features that will be disabled:</p>
            <ul className="space-y-2 rounded-xl border border-border px-4 py-3">
              {features.map((line) => (
                <li key={line} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-warning" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            {props.cancelLabel ?? 'Keep current plan'}
          </Button>
          {blocked || loading || error ? (
            <Button type="button" disabled>
              {loading ? 'Checking…' : error ? `Switch to ${planName}` : 'Resolve issues first'}
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
  cancelLabel?: string
}) {
  return <PlanDowngradeDialog {...props} planId="free" planName="Free" />
}
