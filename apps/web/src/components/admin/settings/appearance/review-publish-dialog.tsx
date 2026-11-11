import { useRef, useState, type ReactNode } from 'react'
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
import { Input } from '@/components/ui/input'
import type { DesignChange } from '@/lib/shared/design/diff'
import { reachesVisitorExtras, type SummaryRow } from '@/lib/shared/design/publish-summary'
import type { DesignAdjustment } from '@/lib/shared/design/resolve'
import { ChangeList } from './change-list'
import { VisitorsAlsoSee } from './visitors-also-see'
import type { PortalDesign } from '@/lib/shared/design/schema'

/** How many rows the summary at the top shows before "Show all". */
export const SUMMARY_ROWS = 4

const changesWord = (count: number) => (count === 1 ? '1 change' : `${count} changes`)

/**
 * The full review: what changes, by part; the page before and after; what
 * else visitors get; then every change with its value now and after. The
 * readability check, and the one step that makes it live.
 */
export function ReviewPublishDialog({
  open,
  onOpenChange,
  changes,
  menu,
  summary = [],
  report,
  onPublish,
  compare,
  canPublish,
  newLogo = false,
  reason,
  design,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  changes: DesignChange[]
  /** Where visitors land and what the menu shows, listed first in place of the menu's raw changes. */
  menu?: SummaryRow[]
  /** The rest, a row for each part it changes and each look set for a page or part. */
  summary?: SummaryRow[]
  report: { adjustments: DesignAdjustment[]; errors: string[] }
  onPublish: (
    message: string | undefined,
    options: { workspaceLogo: boolean }
  ) => Promise<{ ok: true } | { ok: false; message: string }>
  /** The page as visitors see it and as it will be, side by side. */
  compare?: ReactNode
  /** Whether this person may publish; without it, the dialog shows the changes only. */
  canPublish: boolean
  /** Whether the portal's logo is new, which the admin and emails could use too. */
  newLogo?: boolean
  /** Why it opened, such as a check that needs a look, said first. */
  reason?: string
  /** The draft, for the link preview beside the page compare. */
  design?: PortalDesign
}) {
  const [message, setMessage] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [workspaceLogo, setWorkspaceLogo] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const everyChange = useRef<HTMLHeadingElement>(null)
  const blocked = report.errors.length > 0
  const count = changes.length
  // Published, it closes as it was, still publishing; opened again, it starts afresh.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setPublishing(false)
      setMessage('')
      setWorkspaceLogo(false)
    }
  }

  async function publish() {
    setPublishing(true)
    setRefusal(null)
    let outcome: Awaited<ReturnType<typeof onPublish>>
    try {
      outcome = await onPublish(message.trim() || undefined, {
        workspaceLogo: newLogo && workspaceLogo,
      })
    } catch {
      outcome = { ok: false, message: 'Publishing did not reach the server. Try again.' }
    }
    if (outcome.ok) onOpenChange(false)
    else {
      setPublishing(false)
      setRefusal(outcome.message)
    }
  }

  const rows = [...(menu ?? []), ...summary]
  const shownRows = rows.slice(0, SUMMARY_ROWS)
  const moreRows = rows.length - shownRows.length
  const listed = menu
    ? changes.filter((change) => change.path !== 'nav' && !change.path.startsWith('nav.'))
    : changes
  const extras = compare && reachesVisitorExtras(changes)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* It fits the window: the middle scrolls, so Publish is always in view. */}
      <DialogContent
        className={`max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden ${compare ? 'max-w-[min(90rem,calc(100vw-2rem))]' : 'max-w-xl'}`}
      >
        <DialogHeader>
          <DialogTitle>
            {reason ? 'Review and publish' : `Review ${changesWord(count)}`}
          </DialogTitle>
          <DialogDescription>{reason ?? 'Visitors see them once you publish.'}</DialogDescription>
        </DialogHeader>
        <div data-review-scroll="" className="-mx-1 min-h-0 space-y-6 overflow-y-auto px-1">
          {blocked && (
            <div role="alert" className="text-ui text-destructive">
              Text can’t be read on these colours: {report.errors.join('; ')}.
            </div>
          )}
          {rows.length > 0 && (
            <section aria-labelledby="review-what-changes" className="space-y-2">
              <h3 id="review-what-changes" className="text-sm font-semibold">
                What changes
              </h3>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {shownRows.map((row, at) => (
                  <li key={at} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-ui">
                    <span className="w-40 shrink-0 text-muted-foreground">{row.kind}</span>
                    <span className="min-w-0 flex-1">
                      {row.title}
                      {row.detail && <span className="text-muted-foreground"> · {row.detail}</span>}
                    </span>
                  </li>
                ))}
                {moreRows > 0 && (
                  <li className="px-3 py-2 text-ui text-muted-foreground">
                    And {moreRows === 1 ? '1 more part' : `${moreRows} more parts`}
                  </li>
                )}
              </ul>
              <button
                type="button"
                onClick={() => {
                  everyChange.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                  everyChange.current?.focus({ preventScroll: true })
                }}
                className="inline-flex min-h-6 items-center rounded text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-ring"
              >
                Show all {changesWord(count)}
              </button>
            </section>
          )}
          {compare}
          {/* What else the brand reaches, read only, when the draft changes what they use. */}
          {extras && <VisitorsAlsoSee design={design} />}
          <section aria-labelledby="review-every-change" className="space-y-3">
            <h3
              id="review-every-change"
              ref={everyChange}
              tabIndex={-1}
              className="text-sm font-semibold outline-none"
            >
              Every change
            </h3>
            {menu && menu.length > 0 && (
              <section aria-label="Menu and landing" className="space-y-1">
                <h4 className="text-xs font-medium text-muted-foreground">Menu and landing</h4>
                <ul className="space-y-1 text-ui">
                  {menu.map((row, at) => (
                    <li key={at}>
                      {row.title}
                      {row.detail && (
                        <span className="block text-xs text-muted-foreground">{row.detail}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ChangeList changes={listed} />
          </section>
          {report.adjustments.length > 0 && (
            <p className="text-ui text-muted-foreground">
              {report.adjustments.length === 1
                ? 'One colour was adjusted so text stays readable.'
                : `${report.adjustments.length} colours were adjusted so text stays readable.`}
            </p>
          )}
          {canPublish && newLogo && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="publish-workspace-logo"
                checked={workspaceLogo}
                onCheckedChange={(checked) => setWorkspaceLogo(checked === true)}
              />
              <label htmlFor="publish-workspace-logo" className="text-ui">
                Also use the new logo in the admin and emails
              </label>
            </div>
          )}
          {canPublish && (
            <Input
              aria-label="Note for this version"
              placeholder="Note for this version (optional)"
              value={message}
              maxLength={200}
              onChange={(event) => setMessage(event.target.value)}
            />
          )}
          {refusal && (
            <p role="alert" className="text-ui text-destructive">
              {refusal}
            </p>
          )}
          {!canPublish && (
            <p className="text-ui text-muted-foreground">
              Publishing needs permission to publish the design.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={publish} disabled={publishing || blocked || !canPublish}>
            {publishing ? 'Publishing…' : `Publish ${changesWord(count)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
