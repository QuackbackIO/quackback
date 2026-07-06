/**
 * Quinn Copilot's "Save as macro" dialog (split out of copilot-panel.tsx, a
 * pure move — see that file's header for the surface this belongs to): the
 * answer card "..." menu's P2-C.2 action, promoting a Copilot answer to a
 * reusable support macro.
 */
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { stripCitationMarkers } from '@/lib/shared/assistant/copilot-format'
import { saveCopilotAnswerAsMacroFn } from '@/lib/server/functions/macros'
import type { CopilotTurn } from './copilot-panel'

/** First few words of a question, used to prefill the macro name field. */
function firstWords(text: string, count: number): string {
  return text.trim().split(/\s+/).filter(Boolean).slice(0, count).join(' ')
}

/** The answer card "..." menu's "Save as macro" dialog (P2-C.2). Keyed on the
 *  turn's id so switching to a different turn's dialog remounts the form with
 *  a fresh name/body instead of carrying over stale edits. */
export function SaveAsMacroDialog({
  turn,
  onOpenChange,
}: {
  turn: CopilotTurn | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={!!turn} onOpenChange={onOpenChange}>
      <DialogContent>
        {turn && <SaveAsMacroForm key={turn.id} turn={turn} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function SaveAsMacroForm({ turn, onClose }: { turn: CopilotTurn; onClose: () => void }) {
  const [name, setName] = useState(() => firstWords(turn.question, 6))
  const [saving, setSaving] = useState(false)
  const body = useMemo(() => stripCitationMarkers(turn.answer), [turn.answer])

  const save = useCallback(async () => {
    const trimmedName = name.trim()
    if (!trimmedName || saving) return
    setSaving(true)
    try {
      await saveCopilotAnswerAsMacroFn({ data: { name: trimmedName, body } })
      toast.success('Macro saved')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save macro')
    } finally {
      setSaving(false)
    }
  }, [name, body, saving, onClose])

  return (
    <>
      <DialogHeader>
        <DialogTitle>Save as macro</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="copilot-macro-name">Name</Label>
          <Input
            id="copilot-macro-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="copilot-macro-body">Body</Label>
          <Textarea
            id="copilot-macro-body"
            value={body}
            readOnly
            rows={6}
            className="max-h-40 resize-none overflow-y-auto"
          />
        </div>
        {turn.internalSourced && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            This answer used internal sources. Review before saving it as a reusable reply.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}
