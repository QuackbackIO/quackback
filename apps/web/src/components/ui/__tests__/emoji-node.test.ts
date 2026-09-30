// @vitest-environment happy-dom
/**
 * The editor's emoji node, which reads the emoji dataset only once it has
 * loaded it (read-surface-imports.test.ts pins that the editor never imports
 * the dataset statically). The tests run in order: the first two before
 * anything has asked for the dataset.
 */
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

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('emoji node', () => {
  it('renders a stored emoji from its own character', () => {
    const editor = mountEditor(paragraph({ type: 'emoji', attrs: { name: 'tada', emoji: '🎉' } }))
    expect(editor.getHTML()).toContain('🎉')
    expect(editor.view.dom.textContent).toBe('🎉')
  })

  it('shows a node stored without its character as its shortcode, then as the emoji', async () => {
    const editor = mountEditor(paragraph({ type: 'emoji', attrs: { name: 'rocket' } }))
    expect(editor.view.dom.textContent).toBe(':rocket:')
    await loadEmojiData()
    await tick()
    expect(editor.view.dom.textContent).toBe('🚀')
    // The document itself is untouched: no edit, no attrs rewrite.
    expect(emojiNodes(editor)).toEqual([{ name: 'rocket', emoji: null }])
  })

  it('turns a typed :shortcode: into an emoji', () => {
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

  it('writes an emoji to markdown as its shortcode', () => {
    const editor = mountEditor(paragraph({ type: 'emoji', attrs: { name: 'tada', emoji: '🎉' } }))
    expect(editor.getMarkdown().trim()).toBe(':tada:')
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
