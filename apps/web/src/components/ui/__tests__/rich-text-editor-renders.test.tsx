// @vitest-environment happy-dom
/**
 * Typing in a composer costs the keystroke, not the editor's chrome. A
 * controlled host (the comment form's shape: the value held in state and an
 * inline onDocumentChange reading the markdown back) re-renders on every keystroke; the toolbar, bubble menus
 * and context menu around the writing surface must not follow it, and the
 * editor must not run a transaction per keystroke on their behalf. The
 * toolbar still tracks the selection on its own. Mounting the editor hands
 * its host no change it did not make. Button is wrapped in a render counter.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/react'

const buttonRenders = vi.hoisted(() => ({ count: 0 }))

vi.mock('../button', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../button')>()
  function Button(props: React.ComponentProps<typeof actual.Button>) {
    buttonRenders.count++
    return <actual.Button {...props} />
  }
  return { ...actual, Button }
})

const { RichTextEditor } = await import('../rich-text-editor')

afterEach(cleanup)

const upload = async () => 'https://example.com/a.png'

/** The comment composer's features: every toolbar button and bubble menu. */
const FEATURES = {
  headings: true,
  codeBlocks: true,
  taskLists: true,
  blockquotes: true,
  dividers: true,
  images: true,
  videos: true,
  tables: true,
  embeds: true,
  quackbackEmbeds: true,
  bubbleMenu: true,
  slashMenu: true,
  emojiPicker: true,
  enterAsHardBreak: true,
}

function ControlledHost({ onValue }: { onValue?: (markdown: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <RichTextEditor
      value={value}
      borderless
      toolbarPosition="bottom"
      features={{ ...FEATURES }}
      onImageUpload={upload}
      onVideoUpload={upload}
      onDocumentChange={(document) => {
        const markdown = document.markdown()
        setValue(markdown)
        onValue?.(markdown)
      }}
    />
  )
}

async function mountedEditor(container: HTMLElement) {
  const dom = await waitFor(() => {
    const element = container.querySelector<HTMLElement>('.ProseMirror')
    expect(element).not.toBeNull()
    return element!
  })
  return { dom, editor: (dom as HTMLElement & { editor: Editor }).editor }
}

const toolbarButton = (title: string) => screen.getByTitle(title) as HTMLButtonElement
/** The quiet toolbar marks an active button with this background. */
const isActive = (title: string) =>
  toolbarButton(title).className.split(/\s+/).includes('bg-muted/60')

describe('RichTextEditor mount', () => {
  const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })

  it('opens on its initial content without re-applying it', async () => {
    // A blank line stored as `content: []`, which the editor's own JSON omits:
    // the document it holds is equivalent, not identical.
    const value = {
      type: 'doc',
      content: [...doc('Hello').content, { type: 'paragraph', content: [] }],
    }
    const onDocumentChange = vi.fn()
    const { container } = render(
      <RichTextEditor value={value} onDocumentChange={onDocumentChange} />
    )
    const { dom } = await mountedEditor(container)
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(dom.textContent).toBe('Hello')
    // Nothing was done to the document, so there is nothing to undo.
    expect(toolbarButton('Undo').disabled).toBe(true)
    expect(onDocumentChange).not.toHaveBeenCalled()
  })

  it('does not report a change of editability as an edit', async () => {
    const onDocumentChange = vi.fn()
    const value = doc('Hello')
    const { container, rerender } = render(
      <RichTextEditor value={value} onDocumentChange={onDocumentChange} />
    )
    const { editor } = await mountedEditor(container)

    rerender(<RichTextEditor value={value} onDocumentChange={onDocumentChange} disabled />)
    await waitFor(() => expect(editor.isEditable).toBe(false))
    rerender(<RichTextEditor value={value} onDocumentChange={onDocumentChange} />)
    await waitFor(() => expect(editor.isEditable).toBe(true))
    expect(onDocumentChange).not.toHaveBeenCalled()
  })

  it('still takes a new value from the host', async () => {
    const onDocumentChange = vi.fn()
    const { container, rerender } = render(
      <RichTextEditor value={doc('Hello')} onDocumentChange={onDocumentChange} />
    )
    const { dom } = await mountedEditor(container)

    rerender(<RichTextEditor value={doc('Replaced')} onDocumentChange={onDocumentChange} />)
    await waitFor(() => expect(dom.textContent).toBe('Replaced'))
  })
})

describe('RichTextEditor typing', () => {
  it('does not re-render the toolbar or menus per keystroke of a controlled host', async () => {
    const values: string[] = []
    const { container } = render(<ControlledHost onValue={(v) => values.push(v)} />)
    const { dom } = await mountedEditor(container)
    const user = userEvent.setup()
    await user.click(dom)
    // The first keystroke makes Undo available, which the toolbar shows.
    await user.type(dom, 'a')

    buttonRenders.count = 0
    await user.type(dom, 'bcdefghij')

    expect(dom.textContent).toBe('abcdefghij')
    expect(values.at(-1)).toBe('abcdefghij')
    expect(buttonRenders.count).toBe(0)
  })

  it('redraws only the buttons whose state changed', async () => {
    const { container } = render(<ControlledHost />)
    const { dom, editor } = await mountedEditor(container)
    const user = userEvent.setup()
    await user.click(dom)

    // The first keystroke makes Undo available: one toolbar button changes.
    buttonRenders.count = 0
    await user.type(dom, 'a')
    await waitFor(() => expect(toolbarButton('Undo').disabled).toBe(false))
    expect(buttonRenders.count).toBe(1)

    // Bold turns on in the toolbar and in the bubble menu, nothing else.
    buttonRenders.count = 0
    act(() => {
      editor.commands.toggleBold()
    })
    await waitFor(() => expect(isActive('Bold')).toBe(true))
    expect(buttonRenders.count).toBe(2)
  })

  it('runs one transaction per keystroke', async () => {
    const { container } = render(<ControlledHost />)
    const { dom, editor } = await mountedEditor(container)
    const user = userEvent.setup()
    await user.click(dom)
    await user.type(dom, 'a')

    let transactions = 0
    let edits = 0
    const count = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      transactions++
      if (transaction.docChanged) edits++
    }
    editor.on('transaction', count)
    await user.type(dom, 'bcdefghij')
    editor.off('transaction', count)

    expect(edits).toBe(9)
    expect(transactions).toBe(edits)
  })

  it('keeps the toolbar in step with the selection', async () => {
    const { container } = render(<ControlledHost />)
    const { dom, editor } = await mountedEditor(container)
    const user = userEvent.setup()
    await user.click(dom)

    expect(toolbarButton('Undo').disabled).toBe(true)
    await user.type(dom, 'plain')
    await waitFor(() => expect(toolbarButton('Undo').disabled).toBe(false))

    expect(isActive('Bold')).toBe(false)
    await user.click(toolbarButton('Bold'))
    await waitFor(() => expect(isActive('Bold')).toBe(true))
    await user.click(toolbarButton('Bold'))
    await waitFor(() => expect(isActive('Bold')).toBe(false))

    await user.click(toolbarButton('Bullet List'))
    await waitFor(() => expect(isActive('Bullet List')).toBe(true))
    act(() => {
      editor.commands.undo()
    })
    await waitFor(() => expect(isActive('Bullet List')).toBe(false))
    await waitFor(() => expect(toolbarButton('Redo').disabled).toBe(false))
  })

  it('names the block under the selection in the bubble menu', async () => {
    const { container } = render(<ControlledHost />)
    const { dom, editor } = await mountedEditor(container)
    const user = userEvent.setup()
    await user.click(dom)
    await user.type(dom, 'Title')
    await user.click(toolbarButton('Heading 1'))
    await waitFor(() => expect(isActive('Heading 1')).toBe(true))

    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 4 })
    })
    const bubble = await waitFor(
      () => {
        // The bubble's own Bold button, named with its shortcut.
        const menu =
          document.body.querySelector<HTMLElement>('[title="Bold (Cmd+B)"]')?.parentElement
        expect(menu).toBeTruthy()
        return menu!
      },
      { timeout: 2000 }
    )
    await waitFor(() => expect(bubble.textContent).toContain('H1'))
  })
})
