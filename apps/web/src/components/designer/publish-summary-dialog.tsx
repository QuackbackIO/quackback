import { useState } from 'react'
import { CheckIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WORDS } from './properties/words'
import type { DesignCheck } from '@/lib/shared/design/checks'
import type { Selection } from '@/lib/shared/design/outline'
import type { PublishSummary, SummaryRow } from '@/lib/shared/design/publish-summary'

/** What to look at before publishing, each with "Show me"; or that every check passes. */
function Checks({
  checks,
  onShow,
}: {
  checks: readonly DesignCheck[]
  onShow: (part: Selection) => void
}) {
  if (!checks.length)
    return (
      <p className="flex items-center gap-1.5 text-ui text-muted-foreground">
        <CheckIcon className="size-4 text-success" aria-hidden="true" />
        Every check passes
      </p>
    )
  return (
    <section aria-labelledby="summary-checks" className="space-y-1">
      <h3 id="summary-checks" className="text-ui font-medium">
        {checks.length === 1 ? '1 thing to check' : `${checks.length} things to check`}
      </h3>
      <ul className="divide-y divide-border border-t border-border">
        {checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 py-2 text-ui">
            <ExclamationTriangleIcon
              className="mt-0.5 size-3.5 shrink-0 text-warning"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">{check.text}</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto shrink-0 p-0 text-xs text-foreground underline"
              onClick={() => onShow(check.part)}
            >
              Show me
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

type Outcome = { ok: true } | { ok: false; message: string }

function Rows({ title, rows }: { title: string; rows: SummaryRow[] }) {
  if (!rows.length) return null
  return (
    <section className="space-y-1">
      <h3 className="text-ui font-medium">{title}</h3>
      <dl className="divide-y divide-border border-t border-border">
        {rows.map((row, at) => (
          <div key={at} className="grid grid-cols-[6rem_1fr] gap-3 py-2 text-ui">
            <dt className="text-muted-foreground">{row.kind}</dt>
            <dd>
              <span className="block font-medium">{row.title}</span>
              {row.detail && (
                <span className="block text-xs text-muted-foreground">{row.detail}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/**
 * What Publish shows first: what changes, menu and landing first, the
 * choice to use a new logo in the admin and emails (off unless ticked), the
 * checks, and the way to see everything. A dialog, so focus stays inside.
 */
export function PublishSummaryDialog({
  open,
  onOpenChange,
  count,
  summary,
  newLogo,
  checks = [],
  onShowCheck = () => {},
  onSeeEverything,
  onPublish,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  count: number
  summary: PublishSummary
  /** Whether the portal's logo is new, which the admin and emails could use too. */
  newLogo: boolean
  /** Things to check before publishing. */
  checks?: readonly DesignCheck[]
  /** "Show me": closes the summary and picks the part that fixes it. */
  onShowCheck?: (part: Selection) => void
  onSeeEverything: () => void
  onPublish: (options: { workspaceLogo: boolean }) => Promise<Outcome>
}) {
  const [workspaceLogo, setWorkspaceLogo] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  // Published, it closes as it was, still publishing; opened again, it starts afresh.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setPublishing(false)
      setWorkspaceLogo(false)
    }
  }
  const publish = async () => {
    setPublishing(true)
    setRefusal(null)
    const outcome = await onPublish({ workspaceLogo: newLogo && workspaceLogo }).catch(() => ({
      ok: false as const,
      message: 'Publishing did not reach the server. Try again.',
    }))
    if (!outcome.ok) {
      setPublishing(false)
      return setRefusal(outcome.message)
    }
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>
            {count === 1 ? 'Publish 1 change?' : `Publish ${count} changes?`}
          </DialogTitle>
          <DialogDescription>Visitors see them as soon as you publish.</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 space-y-4 overflow-y-auto px-1">
          <Rows title="Menu and landing" rows={summary.menu} />
          <Rows title="Look and words" rows={summary.look} />
          <Rows title={WORDS.setDifferently} rows={summary.overrides} />
          {newLogo && (
            <div className="flex items-start gap-2 rounded-lg border border-border p-3">
              <Checkbox
                id="summary-workspace-logo"
                checked={workspaceLogo}
                onCheckedChange={(checked) => setWorkspaceLogo(checked === true)}
                className="mt-0.5"
              />
              <label htmlFor="summary-workspace-logo" className="text-ui">
                <span className="block font-medium">
                  Also use the new logo in the admin and emails
                </span>
                <span className="block text-xs text-muted-foreground">
                  Off unless you tick it. The workspace logo stays as it is.
                </span>
              </label>
            </div>
          )}
          <Checks checks={checks} onShow={onShowCheck} />
          {refusal && (
            <p role="alert" className="text-ui text-destructive">
              {refusal}
            </p>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={onSeeEverything}>
            See everything
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void publish()} disabled={publishing}>
              {publishing ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
