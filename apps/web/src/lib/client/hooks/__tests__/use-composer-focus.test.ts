// @vitest-environment happy-dom
/**
 * useComposerFocus: the keyboard-first "focus a composer mode" seam behind the
 * inbox's `r` (reply) and `n` (note) shortcuts.
 *
 * The reply and note editors are mutually exclusive in the DOM
 * (agent-conversation-thread.tsx swaps one for the other on `noteMode`), so
 * focusing the mode that ISN'T showing has to flip `noteMode` first and wait
 * for the target editor to mount before its handle is live. A synchronous
 * focus right after `setNoteMode` would race React's re-render and silently
 * no-op.
 *
 * The harness mirrors the real composers' behavior of exposing their handle
 * during render, so exactly one of the two is ever "live".
 */
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useComposerFocus } from '../use-composer-focus'

interface FocusHandle {
  focus: () => void
}

function useHarness(reply: FocusHandle, note: FocusHandle, initialNoteMode = false) {
  const [noteMode, setNoteMode] = useState(initialNoteMode)
  const composerRef = useRef<FocusHandle | null>(null)

  // Only the mounted editor owns the shared ref, exactly as the conditional
  // swap in the thread does.
  composerRef.current = noteMode ? note : reply

  const focusComposer = useComposerFocus({ noteMode, setNoteMode, composerRef })

  return { noteMode, focusComposer }
}

describe('useComposerFocus', () => {
  it('focuses the already-showing composer without touching the mode', () => {
    const reply = { focus: vi.fn() }
    const note = { focus: vi.fn() }
    const { result } = renderHook(() => useHarness(reply, note))

    act(() => result.current.focusComposer('reply'))

    expect(reply.focus).toHaveBeenCalledTimes(1)
    expect(note.focus).not.toHaveBeenCalled()
    expect(result.current.noteMode).toBe(false)
  })

  it('flips to note mode and focuses the note composer once it mounts (the timing case)', () => {
    const reply = { focus: vi.fn() }
    const note = { focus: vi.fn() }
    const { result } = renderHook(() => useHarness(reply, note))

    act(() => result.current.focusComposer('note'))

    expect(result.current.noteMode).toBe(true)
    expect(note.focus).toHaveBeenCalledTimes(1)
    expect(reply.focus).not.toHaveBeenCalled()
  })

  it('flips back to reply mode and focuses the reply composer once it mounts', () => {
    const reply = { focus: vi.fn() }
    const note = { focus: vi.fn() }
    const { result } = renderHook(() => useHarness(reply, note, true))

    act(() => result.current.focusComposer('reply'))

    expect(result.current.noteMode).toBe(false)
    expect(reply.focus).toHaveBeenCalledTimes(1)
    expect(note.focus).not.toHaveBeenCalled()
  })

  it('flushes a queued focus exactly once, not on every later render', () => {
    const reply = { focus: vi.fn() }
    const note = { focus: vi.fn() }
    const { result, rerender } = renderHook(() => useHarness(reply, note))

    act(() => result.current.focusComposer('note'))
    expect(note.focus).toHaveBeenCalledTimes(1)

    rerender()
    act(() => {})

    expect(note.focus).toHaveBeenCalledTimes(1)
  })
})
