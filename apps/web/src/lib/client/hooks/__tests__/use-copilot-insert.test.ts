// @vitest-environment happy-dom
/**
 * useCopilotInsert: the Copilot "Add to composer" / "Add as note" seam. The
 * interesting case is switching composer mode first — the reply and note
 * editors are mutually exclusive (agent-conversation-thread.tsx swaps one for
 * the other on `noteMode`), so an insert into the "other" editor has to wait
 * for it to mount before its ref is live. A naive synchronous call right
 * after `setNoteMode` would race React's re-render and silently no-op; this
 * hook queues the pending insert and flushes it once the target editor's ref
 * is live.
 *
 * The harness below mirrors the real components' behavior of assigning their
 * imperative-handle ref during render (not in an effect) — exactly like
 * ConversationRichComposer / ConversationNoteEditor do (`editorRef.current =
 * editor`) — so only one of the two handles is "live" at a time, gated on
 * `noteMode`, just like the real conditional editor swap.
 */
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCopilotInsert } from '../use-copilot-insert'

// Structural stand-ins for ConversationRichComposerHandle /
// ConversationNoteEditorHandle — lib/ tests must not import from components/,
// and the hook only ever calls `insertText` on either handle.
interface ReplyHandle {
  insertText: (text: string) => void
}
interface NoteHandle {
  insertText: (text: string) => void
}

function makeReplyHandle(): ReplyHandle {
  return { insertText: vi.fn() }
}

function makeNoteHandle(): NoteHandle {
  return { insertText: vi.fn() }
}

function useHarness(handles: { reply: ReplyHandle; note: NoteHandle }, initialNoteMode = false) {
  const [noteMode, setNoteMode] = useState(initialNoteMode)
  const replyComposerRef = useRef<ReplyHandle | null>(null)
  const noteEditorRef = useRef<NoteHandle | null>(null)

  // Mirrors the real editors' "assign the live ref during render" behavior,
  // gated on which one is mounted — only one is ever live at a time.
  if (noteMode) {
    noteEditorRef.current = handles.note
    replyComposerRef.current = null
  } else {
    replyComposerRef.current = handles.reply
    noteEditorRef.current = null
  }

  const insertFromCopilot = useCopilotInsert({
    noteMode,
    setNoteMode,
    replyComposerRef,
    noteEditorRef,
  })

  return { noteMode, insertFromCopilot }
}

describe('useCopilotInsert', () => {
  it('inserts immediately into the reply composer when already in reply mode', () => {
    const reply = makeReplyHandle()
    const note = makeNoteHandle()
    const { result } = renderHook(() => useHarness({ reply, note }))

    act(() => result.current.insertFromCopilot('Here is the answer.', 'reply'))

    expect(reply.insertText).toHaveBeenCalledWith('Here is the answer.')
    expect(note.insertText).not.toHaveBeenCalled()
    expect(result.current.noteMode).toBe(false)
  })

  it('inserts immediately into the note editor when already in note mode', () => {
    const reply = makeReplyHandle()
    const note = makeNoteHandle()
    const { result } = renderHook(() => useHarness({ reply, note }, true))

    act(() => result.current.insertFromCopilot('Internal detail.', 'note'))

    expect(note.insertText).toHaveBeenCalledWith('Internal detail.')
    expect(reply.insertText).not.toHaveBeenCalled()
  })

  it('flips noteMode and flushes the insert into the note editor once it mounts (the timing case)', () => {
    const reply = makeReplyHandle()
    const note = makeNoteHandle()
    const { result } = renderHook(() => useHarness({ reply, note })) // starts in reply mode

    act(() => result.current.insertFromCopilot('This uses internal sources.', 'note'))

    expect(result.current.noteMode).toBe(true)
    expect(note.insertText).toHaveBeenCalledWith('This uses internal sources.')
    expect(reply.insertText).not.toHaveBeenCalled()
  })

  it('flips noteMode back to reply and flushes the insert into the reply composer once it mounts', () => {
    const reply = makeReplyHandle()
    const note = makeNoteHandle()
    const { result } = renderHook(() => useHarness({ reply, note }, true)) // starts in note mode

    act(() => result.current.insertFromCopilot('Add this to the reply.', 'reply'))

    expect(result.current.noteMode).toBe(false)
    expect(reply.insertText).toHaveBeenCalledWith('Add this to the reply.')
    expect(note.insertText).not.toHaveBeenCalled()
  })
})
