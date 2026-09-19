/**
 * The verdict form for an effect nobody could confirm.
 *
 * Two outcomes and a note, and deliberately no third button. An unconfirmed
 * external write is the one state from which repeating the action could do it
 * twice, so the only thing this control offers is a person recording what they
 * found: either the effect is there (resolved) or it is not (did not happen).
 * Somebody who decides it should happen after all asks for it again, which is a
 * new proposal and a new decision.
 */
import { useState } from 'react'
import type { AssistantPendingActionId } from '@quackback/ids'
import { useReconcileAssistantAction } from '@/lib/client/mutations/assistant-pending-actions'
import { Textarea } from '@/components/ui/textarea'

export function ActionReconcileForm({
  pendingActionId,
  receiptId,
  onDone,
  onCancel,
}: {
  pendingActionId?: AssistantPendingActionId
  receiptId?: string
  onDone: () => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  const reconcile = useReconcileAssistantAction()
  const submit = (verdict: 'resolved' | 'failed') => {
    if (!note.trim()) return
    reconcile.mutate(
      { pendingActionId, receiptId, verdict, note: note.trim() },
      { onSuccess: onDone }
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What did you find?"
        className="min-h-0 text-[11px]"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => submit('resolved')}
          disabled={!note.trim() || reconcile.isPending}
          className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          It happened
        </button>
        <button
          type="button"
          onClick={() => submit('failed')}
          disabled={!note.trim() || reconcile.isPending}
          className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          It did not
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] text-muted-foreground hover:underline"
        >
          Cancel
        </button>
      </div>
      {reconcile.isError && (
        <span className="text-[11px] text-destructive">
          {reconcile.error instanceof Error ? reconcile.error.message : 'Something went wrong'}
        </span>
      )}
    </div>
  )
}
