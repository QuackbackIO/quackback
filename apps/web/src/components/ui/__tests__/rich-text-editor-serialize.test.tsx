// @vitest-environment happy-dom
/**
 * A keystroke serializes only what its host reads. onDocumentChange hands a
 * document that serializes on read, each format once. Serializations
 * are counted where they happen: the document's toJSON, the DOM serializer
 * behind HTML and the markdown manager.
 */
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DOMSerializer, Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { Editor, JSONContent } from '@tiptap/react'
import { RichTextEditor, type EditorDocument } from '../rich-text-editor'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function mountedEditor(container: HTMLElement) {
  const dom = await waitFor(() => {
    const element = container.querySelector<HTMLElement>('.ProseMirror')
    expect(element).not.toBeNull()
    return element!
  })
  return { dom, editor: (dom as HTMLElement & { editor: Editor }).editor }
}

/** Counts whole-document serializations from here on. */
function countSerializations(editor: Editor) {
  const toJSON = vi.spyOn(ProseMirrorNode.prototype, 'toJSON')
  const html = vi.spyOn(DOMSerializer.prototype, 'serializeFragment')
  const markdown = vi.spyOn(editor.markdown!, 'serialize')
  return () => ({
    json: toJSON.mock.contexts.filter((node) => (node as ProseMirrorNode).type.name === 'doc')
      .length,
    // Nested content serializes through the same method with a target node.
    html: html.mock.calls.filter((call) => call[2] === undefined).length,
    markdown: markdown.mock.calls.length,
  })
}

const paragraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('RichTextEditor onDocumentChange', () => {
  it('serializes nothing while the host only keeps the document', async () => {
    const documents: EditorDocument[] = []
    const { container } = render(
      <RichTextEditor onDocumentChange={(document) => documents.push(document)} />
    )
    const { dom, editor } = await mountedEditor(container)
    const user = userEvent.setup()
    await user.click(dom)
    const counts = countSerializations(editor)

    await user.type(dom, 'hello')

    expect(documents).toHaveLength(5)
    expect(counts()).toEqual({ json: 0, html: 0, markdown: 0 })
  })

  it('serializes each format once, when it is read', async () => {
    const documents: EditorDocument[] = []
    const { container } = render(
      <RichTextEditor onDocumentChange={(document) => documents.push(document)} />
    )
    const { dom, editor } = await mountedEditor(container)
    const user = userEvent.setup()
    await user.click(dom)
    await user.type(dom, 'hello')
    const counts = countSerializations(editor)
    const latest = documents.at(-1)!

    expect(latest.markdown()).toBe('hello')
    expect(latest.markdown()).toBe('hello')
    expect(latest.json()).toEqual(paragraph('hello'))
    expect(latest.html()).toBe('<p>hello</p>')
    expect(latest.html()).toBe('<p>hello</p>')
    expect(counts()).toEqual({ json: 1, html: 1, markdown: 1 })
  })

  it('reads an earlier document as it was at that edit', async () => {
    const documents: EditorDocument[] = []
    const { container } = render(
      <RichTextEditor onDocumentChange={(document) => documents.push(document)} />
    )
    const { dom } = await mountedEditor(container)
    const user = userEvent.setup()
    await user.click(dom)
    await user.type(dom, 'hello')

    expect(documents[0]!.markdown()).toBe('h')
    expect(documents[1]!.json()).toEqual(paragraph('he'))
  })

  it('keeps a line of spaces when the host feeds the markdown it read back as the value', async () => {
    // The comment form's shape once a submit has been tried: each change reads
    // the markdown into the form, and the form hands it back as `value`.
    function EchoHost() {
      const [value, setValue] = useState('')
      return (
        <RichTextEditor
          value={value}
          onDocumentChange={(document) => setValue(document.markdown())}
        />
      )
    }
    const { container } = render(<EchoHost />)
    const { editor } = await mountedEditor(container)
    act(() => {
      editor.commands.insertContent('a ')
    })
    // Only the space is left, whose markdown is empty: applying '' as a new
    // value would clear the line the writer is on.
    act(() => {
      editor.commands.deleteRange({ from: 1, to: 2 })
    })

    expect(editor.getJSON().content?.[0]).toEqual(paragraph(' ').content[0])
  })

  it('does not re-read the JSON its host feeds back as the value', async () => {
    function EchoHost() {
      const [value, setValue] = useState<JSONContent | string>('')
      return (
        <RichTextEditor value={value} onDocumentChange={(document) => setValue(document.json())} />
      )
    }
    const { container } = render(<EchoHost />)
    const { editor } = await mountedEditor(container)
    const counts = countSerializations(editor)

    // Each edit settles (the host re-renders and the value lands) before the next.
    for (const character of 'hello') {
      act(() => {
        editor.commands.insertContent(character)
      })
    }

    expect(editor.getText()).toBe('hello')
    expect(counts().json).toBe(5)
  })
})
