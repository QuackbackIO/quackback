// @vitest-environment happy-dom
/**
 * <ConversationRichComposer> imperative handle: `getText` (the Copilot Format
 * chip's read seam) and `replaceText`/`undo` (the transform-replace flow,
 * P2-C.1). TipTap doesn't run meaningfully in happy-dom, so `@tiptap/react`'s
 * `useEditor` is mocked to a plain chainable stand-in editor: this pins the
 * handle's plumbing (which editor methods get called, and that replaceText's
 * select-all + insert happen on a SINGLE chain, i.e. one transaction) rather
 * than real ProseMirror behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { createRef } from 'react'

function makeChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['focus', 'insertContent', 'selectAll', 'undo', 'clearContent']) {
    chain[method] = vi.fn(() => chain)
  }
  chain.run = vi.fn(() => true)
  return chain
}

const mockEditor = {
  isDestroyed: false,
  getText: vi.fn(() => 'hello world'),
  getJSON: vi.fn(() => ({ type: 'doc', content: [] })),
  setEditable: vi.fn(),
  chain: vi.fn(),
}

vi.mock('@tiptap/react', () => ({
  useEditor: () => mockEditor,
  EditorContent: () => null,
}))

import {
  ConversationRichComposer,
  type ConversationRichComposerHandle,
} from '../conversation-rich-composer'

function renderComposer() {
  const ref = createRef<ConversationRichComposerHandle>()
  render(
    <ConversationRichComposer ref={ref} resetSignal={0} onChange={() => {}} onSubmit={() => {}} />
  )
  return ref
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEditor.isDestroyed = false
  mockEditor.getText.mockReturnValue('hello world')
})

describe('<ConversationRichComposer> handle', () => {
  it('getText reads the live editor plain text', () => {
    const ref = renderComposer()
    expect(ref.current?.getText()).toBe('hello world')
  })

  it('getText returns an empty string once the editor is destroyed', () => {
    mockEditor.isDestroyed = true
    const ref = renderComposer()
    expect(ref.current?.getText()).toBe('')
  })

  it('replaceText selects all and inserts on a single chain (one undoable transaction)', () => {
    const chain = makeChain()
    mockEditor.chain.mockReturnValue(chain)
    const ref = renderComposer()

    ref.current?.replaceText('New draft text')

    // One chain() call = one ProseMirror transaction; select-all + insert both
    // ride it, so a single Ctrl+Z restores the prior draft in one step.
    expect(mockEditor.chain).toHaveBeenCalledTimes(1)
    expect(chain.focus).toHaveBeenCalled()
    expect(chain.selectAll).toHaveBeenCalled()
    expect(chain.insertContent).toHaveBeenCalledWith('New draft text')
    expect(chain.run).toHaveBeenCalledTimes(1)
  })

  it('undo runs the editor chain undo command', () => {
    const chain = makeChain()
    mockEditor.chain.mockReturnValue(chain)
    const ref = renderComposer()

    ref.current?.undo()

    expect(chain.undo).toHaveBeenCalled()
    expect(chain.run).toHaveBeenCalledTimes(1)
  })

  it('is a no-op once the editor is destroyed', () => {
    const chain = makeChain()
    mockEditor.chain.mockReturnValue(chain)
    mockEditor.isDestroyed = true
    const ref = renderComposer()

    ref.current?.replaceText('ignored')
    ref.current?.undo()

    expect(chain.run).not.toHaveBeenCalled()
  })
})
