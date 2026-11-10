import { useCallback, useState } from 'react'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import { useUndoKeys } from '@/components/admin/settings/appearance/use-undo-keys'

/**
 * What a screen reader hears after a pick, an add, a move, an undo or a
 * redo; cleared first, so a repeat is read again. Undo and redo say what
 * they took back or put back, from the keys or the top bar.
 */
export function useSaid(
  draft: Pick<ReturnType<typeof useDesignDraft>, 'undo' | 'redo' | 'undoLabel' | 'redoLabel'>
) {
  const [said, setSaid] = useState('')
  const say = useCallback((text: string) => {
    setSaid('')
    requestAnimationFrame(() => setSaid(text))
  }, [])
  const undo = useCallback(() => {
    if (!draft.undoLabel) return
    say(`Undone: ${draft.undoLabel}`)
    draft.undo()
  }, [draft, say])
  const redo = useCallback(() => {
    if (!draft.redoLabel) return
    say(`Redone: ${draft.redoLabel}`)
    draft.redo()
  }, [draft, say])
  useUndoKeys(undo, redo)
  return { said, say, undo, redo }
}
