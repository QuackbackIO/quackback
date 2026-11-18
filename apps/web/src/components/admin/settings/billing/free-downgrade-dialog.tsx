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
import type { PlanCapInfo, PlanDowngradeIssue } from '@/lib/shared/billing/plan-downgrade'
import { errorText } from '@/lib/client/error-text'
import { infoRowNote } from '@/lib/shared/billing/plan-limits-copy'
import { PlanLimitIssues, type PlanLimitRow } from './plan-limit-issues'

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
  /** The plan the workspace is on, for "Keep {plan}". */
  currentPlanName?: string
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
  const confirmLabel = `Downgrade to ${planName}`

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Downgrade to {planName}</DialogTitle>
          <DialogDescription>
            {blocked
              ? `${planName} includes less than you use today.`
              : `Check what changes on ${planName}, then confirm.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">
            Checking this workspace against {planName}…
          </p>
        ) : error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : blocked || info.length > 0 ? (
          <PlanLimitIssues
            rows={[
              ...issues.map((issue): PlanLimitRow => ({
                key: issue.key,
                used: issue.used,
                cap: issue.cap,
                status: 'over',
                actions: (
                  <Button size="sm" variant="outline" asChild>
                    <a href={issue.href}>{issue.actionLabel}</a>
                  </Button>
                ),
              })),
              ...info.map((row): PlanLimitRow => ({
                key: row.key,
                used: row.used,
                cap: row.cap,
                status: 'info',
                note: infoRowNote(row),
              })),
            ]}
          />
        ) : null}

        {!loading && !error && blocked ? (
          <p className="text-[13px] text-muted-foreground">
            Fix these issues to downgrade to {planName}.
          </p>
        ) : null}

        {!loading && !error && !blocked ? (
          <p className="text-sm text-muted-foreground">This workspace fits the {planName} plan.</p>
        ) : null}

        {features.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium">What pauses on {planName}</p>
            <ul className="space-y-1 rounded-xl border border-border px-4 py-3">
              {features.map((line) => (
                <li key={line} className="flex gap-2 text-[13px] text-muted-foreground">
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/70" />
                  {line}
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-muted-foreground">
              Nothing is deleted. It comes back when you upgrade.
            </p>
          </div>
        ) : null}

        <DialogFooter>
          {/* While anything is over, staying is the one action: no greyed-out switch. */}
          <Button
            type="button"
            variant={blocked && !loading && !error ? 'default' : 'outline'}
            onClick={() => props.onOpenChange(false)}
          >
            {props.cancelLabel ??
              (props.currentPlanName ? `Keep ${props.currentPlanName}` : 'Cancel')}
          </Button>
          {blocked && !loading && !error ? null : loading || error ? (
            <Button type="button" variant="outline" disabled>
              {loading ? 'Checking…' : confirmLabel}
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
  currentPlanName?: string
}) {
  return <PlanDowngradeDialog {...props} planId="free" planName="Free" />
}
