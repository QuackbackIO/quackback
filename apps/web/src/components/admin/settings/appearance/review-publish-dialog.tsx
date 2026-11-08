import { useState, type ReactNode } from 'react'
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
import type { SummaryRow } from '@/lib/shared/design/publish-summary'
import type { DesignAdjustment } from '@/lib/shared/design/resolve'
import { ChangeList } from './change-list'
import { VisitorsAlsoSee } from './visitors-also-see'
import type { PortalDesign } from '@/lib/shared/design/schema'

/** Every change in the draft, the readability check, and the one step that makes it live. */
export function ReviewPublishDialog({
  open,
  onOpenChange,
  changes,
  menu,
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
  /** Why it opened in place of a shorter summary, said first. */
  reason?: string
  /** The draft, for the link preview beside the page compare. */
  design?: PortalDesign
}) {
  const [message, setMessage] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [workspaceLogo, setWorkspaceLogo] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const blocked = report.errors.length > 0

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
    } finally {
      setPublishing(false)
    }
    if (outcome.ok) {
      setMessage('')
      setWorkspaceLogo(false)
      onOpenChange(false)
    } else {
      setRefusal(outcome.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* It fits the window: the middle scrolls, so Publish is always in view. */}
      <DialogContent
        className={`max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] ${compare ? 'max-w-6xl' : 'max-w-xl'}`}
      >
        <DialogHeader>
          <DialogTitle>Review and publish</DialogTitle>
          <DialogDescription>
            {reason ? `${reason} ` : ''}Visitors see these changes once you publish.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 space-y-4 overflow-y-auto px-1">
          {compare}
          {/* Beside the page compare: what else the brand reaches, read only. */}
          {compare && <VisitorsAlsoSee design={design} />}
          {menu && menu.length > 0 && (
            <section aria-label="Menu and landing" className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">Menu and landing</h3>
              <ul className="space-y-1 text-[13px]">
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
          <ChangeList
            changes={
              menu
                ? changes.filter(
                    (change) => change.path !== 'nav' && !change.path.startsWith('nav.')
                  )
                : changes
            }
          />
          {report.adjustments.length > 0 && (
            <p className="text-[13px] text-muted-foreground">
              {report.adjustments.length === 1
                ? 'One colour was adjusted so text stays readable.'
                : `${report.adjustments.length} colours were adjusted so text stays readable.`}
            </p>
          )}
          {blocked && (
            <div role="alert" className="text-[13px] text-destructive">
              Text can’t be read on these colours: {report.errors.join('; ')}.
            </div>
          )}
          {canPublish && newLogo && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="publish-workspace-logo"
                checked={workspaceLogo}
                onCheckedChange={(checked) => setWorkspaceLogo(checked === true)}
              />
              <label htmlFor="publish-workspace-logo" className="text-[13px]">
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
            <p role="alert" className="text-[13px] text-destructive">
              {refusal}
            </p>
          )}
          {!canPublish && (
            <p className="text-[13px] text-muted-foreground">
              Publishing needs permission to publish the design.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={publish} disabled={publishing || blocked || !canPublish}>
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
