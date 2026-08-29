import { useQuery } from '@tanstack/react-query'
import { billingQueries } from '@/lib/client/queries/billing'
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

export function FreeDowngradeDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const preview = useQuery({
    ...billingQueries.freeDowngradePreview(),
    enabled: props.open,
  })
  const issues = preview.data?.issues ?? []
  const features = preview.data?.featuresDisabled ?? []
  const blocked = issues.length > 0

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Action required before downgrading</DialogTitle>
          <DialogDescription>
            Please resolve the following issues before downgrading to the Free plan.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertDescription>
            Downgrading to the Free plan will remove access to paid features.
          </AlertDescription>
        </Alert>

        {preview.isLoading ? (
          <p className="text-sm text-muted-foreground">Checking this workspace against Free…</p>
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
          <p className="text-sm text-muted-foreground">This workspace fits the Free plan.</p>
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
          <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
            Keep features
          </Button>
          {blocked ? (
            <Button type="button" disabled>
              Resolve issues first
            </Button>
          ) : (
            <form method="post" action="/api/billing/session">
              <input type="hidden" name="action" value="downgrade" />
              <input type="hidden" name="planId" value="free" />
              <Button type="submit" variant="destructive">
                Switch to Free
              </Button>
            </form>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
