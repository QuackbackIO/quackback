import { useState } from 'react'
import { Button } from '@/components/ui/button'
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
import type { DesignAdjustment } from '@/lib/shared/design/resolve'
import { ChangeList } from './change-list'

/** Every change in the draft, the readability check, and the one step that makes it live. */
export function ReviewPublishDialog({
  open,
  onOpenChange,
  changes,
  report,
  onPublish,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  changes: DesignChange[]
  report: { adjustments: DesignAdjustment[]; errors: string[] }
  onPublish: (message?: string) => Promise<{ ok: true } | { ok: false; message: string }>
}) {
  const [message, setMessage] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const blocked = report.errors.length > 0

  async function publish() {
    setPublishing(true)
    setRefusal(null)
    const outcome = await onPublish(message.trim() || undefined)
    setPublishing(false)
    if (outcome.ok) {
      setMessage('')
      onOpenChange(false)
    } else {
      setRefusal(outcome.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Review and publish</DialogTitle>
          <DialogDescription>Visitors see these changes once you publish.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* A long draft scrolls here, so Publish stays in view. */}
          <div className="max-h-[50vh] overflow-y-auto">
            <ChangeList changes={changes} />
          </div>
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
          <Input
            aria-label="Note for this version"
            placeholder="Note for this version (optional)"
            value={message}
            maxLength={200}
            onChange={(event) => setMessage(event.target.value)}
          />
          {refusal && (
            <p role="alert" className="text-[13px] text-destructive">
              {refusal}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={publish} disabled={publishing || blocked}>
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
