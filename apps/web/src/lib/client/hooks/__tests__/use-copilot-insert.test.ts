// @vitest-environment happy-dom
/**
 * useCopilotInsert: the Copilot "Add to composer" seam. The interesting case
 * is when the note editor is showing — the reply and note editors are
 * mutually exclusive (agent-conversation-thread.tsx swaps one for the other
 * on `noteMode`), so an insert has to flip back to reply mode and wait for
 * the reply composer to mount before its ref is live. A naive synchronous
 * call right after `setNoteMode` would race React's re-render and silently
 * no-op; this hook queues the pending insert and flushes it once the reply
 * composer's ref is live.
 *
 * The harness below mirrors the real composers' behavior of exposing their
 * insert seam during render (not in an effect) — so the reply handle is only
 * "live" while `noteMode` is off, just like the real conditional editor swap.
 */
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCopilotInsert } from '../use-copilot-insert'

// Structural stand-in for the composer's insert handle — lib/ tests must not
// import from components/, and the hook only ever calls `insertText` on it.
interface ReplyHandle {
  insertText: (text: string) => void
}

function makeReplyHandle(): ReplyHandle {
  return { insertText: vi.fn() }
}

function useHarness(reply: ReplyHandle, initialNoteMode = false) {
  const [noteMode, setNoteMode] = useState(initialNoteMode)
  const replyComposerRef = useRef<ReplyHandle | null>(null)

  // Mirrors the real editor's "assign the live ref during render" behavior,
  // gated on which composer is mounted.
  replyComposerRef.current = noteMode ? null : reply

  const insertFromCopilot = useCopilotInsert({
    noteMode,
    setNoteMode,
    replyComposerRef,
  })

  return { noteMode, insertFromCopilot }
}

describe('useCopilotInsert', () => {
  it('inserts immediately into the reply composer when already in reply mode', () => {
    const reply = makeReplyHandle()
    const { result } = renderHook(() => useHarness(reply))

    act(() => result.current.insertFromCopilot('Here is the answer.'))

    expect(reply.insertText).toHaveBeenCalledWith('Here is the answer.')
    expect(result.current.noteMode).toBe(false)
  })

  it('flips noteMode back to reply and flushes the insert once the composer mounts (the timing case)', () => {
    const reply = makeReplyHandle()
    const { result } = renderHook(() => useHarness(reply, true)) // starts in note mode

    act(() => result.current.insertFromCopilot('Add this to the reply.'))

    expect(result.current.noteMode).toBe(false)
    expect(reply.insertText).toHaveBeenCalledWith('Add this to the reply.')
  })
})
