// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import { buildExtensions, createEmojiExtension } from '../rich-text-editor'
import { loadEmojiData } from '../emoji-node'

const POST_EDITOR_FEATURES = {
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
}

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function mountEditor(content: JSONContent | string) {
  const element = document.createElement('div')
  document.body.appendChild(element)
  const editor = new Editor({
    element,
    extensions: buildExtensions(POST_EDITOR_FEATURES, { placeholder: 'Write...' }),
    content,
  })
  editors.push(editor)
  return editor
}

const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content }],
})

/** Types `text` at the cursor the way a keypress does, so input rules run. */
function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection
  const handled = editor.view.someProp('handleTextInput', (handle) =>
    handle(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to))
  )
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to))
}

function emojiNodes(editor: Editor) {
  const found: Record<string, unknown>[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'emoji') found.push({ ...node.attrs })
  })
  return found
}

describe('emoji node', () => {
  it('renders a stored emoji from its own character', () => {
    const editor = mountEditor(paragraph({ type: 'emoji', attrs: { name: 'tada', emoji: '🎉' } }))
    expect(editor.getHTML()).toContain('🎉')
    expect(editor.view.dom.textContent).toBe('🎉')
  })

  it('preserves a stored character through HTML copy and paste', () => {
    const original = mountEditor(
      paragraph({ type: 'emoji', attrs: { name: 'rocket', emoji: '🚀' } })
    )
    const copied = mountEditor(original.getHTML())
    expect(emojiNodes(copied)).toEqual([{ name: 'rocket', emoji: '🚀' }])
    expect(copied.getText()).toBe('🚀')
  })

  it('turns a typed :shortcode: into an emoji', async () => {
    await loadEmojiData()
    const editor = mountEditor('<p>Shipped </p>')
    editor.commands.focus('end')
    type(editor, ':tada')
    type(editor, ':')
    expect(emojiNodes(editor)).toEqual([{ name: 'tada', emoji: '🎉' }])
  })

  it('turns an emoticon into an emoji once a space follows it', () => {
    const editor = mountEditor('<p>Thanks</p>')
    editor.commands.focus('end')
    type(editor, ' ')
    type(editor, '<3')
    type(editor, ' ')
    expect(emojiNodes(editor)).toEqual([{ name: 'heart', emoji: '❤' }])
    expect(editor.getText()).toBe('Thanks ❤ ')
  })

  it('leaves words that are not emoticons alone', () => {
    const editor = mountEditor('<p>see</p>')
    editor.commands.focus('end')
    type(editor, ' ')
    type(editor, 'it')
    type(editor, ' ')
    expect(emojiNodes(editor)).toEqual([])
    expect(editor.getText()).toBe('see it ')
  })

  it('turns emoji typed or pasted as characters into emoji nodes', () => {
    const editor = mountEditor('<p></p>')
    editor.commands.insertContent('Party 🎉 time')
    // Named by its first shortcode, as the upstream extension names them.
    expect(emojiNodes(editor)).toEqual([{ name: 'party', emoji: '🎉' }])
    expect(editor.getText()).toBe('Party 🎉 time')
  })

  it('writes the stored Unicode character to markdown', () => {
    const editor = mountEditor(paragraph({ type: 'emoji', attrs: { name: 'tada', emoji: '🎉' } }))
    expect(editor.getMarkdown().trim()).toBe('🎉')
  })

  it('offers the picker matches from the loaded dataset', async () => {
    const { items } = createEmojiExtension().options.suggestion
    const matches = await items!({
      query: 'tada',
      editor: mountEditor('<p></p>'),
      signal: new AbortController().signal,
    })
    expect(matches.map((item) => item.emoji)).toContain('🎉')
  })
})
