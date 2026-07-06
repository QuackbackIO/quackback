import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

type InsertMode = 'reply' | 'note'

// Structural rather than importing ConversationRichComposerHandle /
// ConversationNoteEditorHandle from components/ — lib/ must not import from
// components/ (both real handles satisfy this shape).
interface InsertableHandle {
  insertText: (text: string) => void
}

/**
 * The Copilot sidebar's "Add to composer" / "Add as note" seam
 * (COPILOT-SIDEBAR-UX.md B.4), mirroring `insertMacroBody` but across BOTH
 * composer modes: the reply and note editors are mutually exclusive in the DOM
 * (agent-conversation-thread.tsx swaps one for the other on `noteMode`), so
 * inserting into the "other" editor first requires flipping `noteMode` and
 * waiting for that editor to mount before its ref is live.
 *
 * `setNoteMode(...)` schedules a state update; the target editor doesn't exist
 * (its ref is still null/stale) until AFTER the resulting re-render commits.
 * A synchronous `insertText` call right after `setNoteMode` would race that
 * commit and silently no-op. Instead we queue the pending insert and flush it
 * from an effect that runs after every render, once the editor whose mode
 * matches the pending request has mounted.
 */
export function useCopilotInsert({
  noteMode,
  setNoteMode,
  replyComposerRef,
  noteEditorRef,
}: {
  noteMode: boolean
  setNoteMode: (noteMode: boolean) => void
  replyComposerRef: RefObject<InsertableHandle | null>
  noteEditorRef: RefObject<InsertableHandle | null>
}): (text: string, mode: InsertMode) => void {
  const pendingRef = useRef<{ text: string; mode: InsertMode } | null>(null)

  // The queue is only ever populated right around a mode flip (see the
  // callback below), so this only needs to run when `noteMode` itself
  // changes — not on every unrelated render. The editors assign their
  // imperative-handle refs during render (not in an effect), so by the time
  // this effect runs after a `noteMode` commit, the target editor's ref is
  // already live.
  useEffect(() => {
    const pending = pendingRef.current
    if (!pending) return
    // The target editor hasn't mounted yet — its mode flip hasn't committed.
    if (pending.mode === 'reply' && noteMode) return
    if (pending.mode === 'note' && !noteMode) return
    pendingRef.current = null
    if (pending.mode === 'reply') replyComposerRef.current?.insertText(pending.text)
    else noteEditorRef.current?.insertText(pending.text)
  }, [noteMode])

  return useCallback(
    (text: string, mode: InsertMode) => {
      const alreadyInMode = mode === 'reply' ? !noteMode : noteMode
      if (alreadyInMode) {
        if (mode === 'reply') replyComposerRef.current?.insertText(text)
        else noteEditorRef.current?.insertText(text)
        return
      }
      pendingRef.current = { text, mode }
      setNoteMode(mode === 'note')
    },
    [noteMode, setNoteMode, replyComposerRef, noteEditorRef]
  )
}
