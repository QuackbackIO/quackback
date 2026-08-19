import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

// Structural rather than importing the composer's insert handle from
// components/ — lib/ must not import from components/. The reply composer
// exposes an object of this shape.
interface InsertableHandle {
  insertText: (text: string) => void
}

/**
 * The Copilot sidebar's "Add to composer" seam (COPILOT-SIDEBAR-UX.md B.4),
 * mirroring `insertMacroBody` but robust to the composer being hidden: the
 * reply and note editors are mutually exclusive in the DOM
 * (agent-conversation-thread.tsx swaps one for the other on `noteMode`), so
 * inserting while the note editor is showing first requires flipping
 * `noteMode` back and waiting for the reply composer to mount before its ref
 * is live.
 *
 * `setNoteMode(false)` schedules a state update; the reply composer doesn't
 * exist (its ref is still null/stale) until AFTER the resulting re-render
 * commits. A synchronous `insertText` call right after `setNoteMode` would
 * race that commit and silently no-op. Instead we queue the pending insert
 * and flush it from an effect once the reply composer has mounted.
 */
export function useCopilotInsert({
  noteMode,
  setNoteMode,
  replyComposerRef,
}: {
  noteMode: boolean
  setNoteMode: (noteMode: boolean) => void
  replyComposerRef: RefObject<InsertableHandle | null>
}): (text: string) => void {
  const pendingRef = useRef<string | null>(null)

  // The queue is only ever populated right around a mode flip (see the
  // callback below), so this only needs to run when `noteMode` itself
  // changes — not on every unrelated render. The composer assigns its
  // imperative-handle ref during render (not in an effect), so by the time
  // this effect runs after a `noteMode` commit, the ref is already live.
  useEffect(() => {
    const pending = pendingRef.current
    if (pending === null || noteMode) return
    pendingRef.current = null
    replyComposerRef.current?.insertText(pending)
  }, [noteMode])

  return useCallback(
    (text: string) => {
      if (!noteMode) {
        replyComposerRef.current?.insertText(text)
        return
      }
      pendingRef.current = text
      setNoteMode(false)
    },
    [noteMode, setNoteMode, replyComposerRef]
  )
}
