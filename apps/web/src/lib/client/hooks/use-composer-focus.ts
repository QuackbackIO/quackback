import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'

// Structural rather than importing the composer's handle from components/ —
// lib/ must not import from components/. The mounted editor exposes an object
// of this shape.
interface FocusableHandle {
  focus: () => void
}

/** The two composer modes an agent thread can be in. */
type ComposerMode = 'reply' | 'note'

/**
 * The keyboard-first "focus a composer mode" seam behind the inbox's `r` and
 * `n` shortcuts (support platform §4.6), mirroring `useCopilotInsert`'s
 * mount-timing contract.
 *
 * The reply and note editors are mutually exclusive in the DOM
 * (agent-conversation-thread.tsx swaps one for the other on `noteMode`), so
 * only the mounted one publishes a handle on the shared ref. Focusing the mode
 * that ISN'T showing therefore has to flip `noteMode` and wait: `setNoteMode`
 * merely schedules a state update, and the target editor does not exist until
 * AFTER the resulting re-render commits, so a synchronous focus would race the
 * commit and silently land on nothing. The pending mode is queued and flushed
 * from an effect once the requested mode is the committed one.
 */
export function useComposerFocus({
  noteMode,
  setNoteMode,
  composerRef,
}: {
  noteMode: boolean
  setNoteMode: (noteMode: boolean) => void
  composerRef: RefObject<FocusableHandle | null>
}): (mode: ComposerMode) => void {
  // The mode a queued focus is waiting on, or null when nothing is queued.
  const pendingRef = useRef<boolean | null>(null)

  // Only populated right around a mode flip (see the callback below), so this
  // runs on `noteMode` changes alone rather than every unrelated render. The
  // editor publishes its handle in a layout effect, which has already run by
  // the time this passive effect fires.
  useEffect(() => {
    const pending = pendingRef.current
    if (pending === null || pending !== noteMode) return
    pendingRef.current = null
    composerRef.current?.focus()
  }, [noteMode])

  return useCallback(
    (mode: ComposerMode) => {
      const wantNote = mode === 'note'
      if (wantNote === noteMode) {
        composerRef.current?.focus()
        return
      }
      pendingRef.current = wantNote
      setNoteMode(wantNote)
    },
    [noteMode, setNoteMode, composerRef]
  )
}
