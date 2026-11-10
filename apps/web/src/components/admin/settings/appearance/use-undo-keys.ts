import { useEffect } from 'react'

/** Whether a key press belongs to a field that keeps its own undo, such as text being typed. */
function inField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * The usual undo and redo keys for the design draft: Ctrl or Cmd with Z,
 * with Shift or Y to redo. A field being typed in keeps them for its own text.
 */
export function useUndoKeys(undo: () => void, redo: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || inField(event.target)) return
      const key = event.key.toLowerCase()
      if (key === 'z' && !event.shiftKey) undo()
      else if ((key === 'z' && event.shiftKey) || key === 'y') redo()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])
}
