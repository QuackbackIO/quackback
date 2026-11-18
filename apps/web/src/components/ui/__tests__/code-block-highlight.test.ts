// @vitest-environment happy-dom
/**
 * Code block grammars load the first time an editor's document holds a code
 * block, then highlight what is already there without counting as an edit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { undoDepth } from '@tiptap/pm/history'

type Module = typeof import('../code-block-highlight')

let mod: Module
const editors: Editor[] = []

beforeEach(async () => {
  // The grammars register once per page; a fresh module is a fresh page.
  vi.resetModules()
  mod = await import('../code-block-highlight')
})

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function makeEditor(content: string) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      mod.CodeBlockHighlight.configure({ lowlight: mod.lowlight }),
    ],
    content,
  })
  editors.push(editor)
  return editor
}

const highlighted = (editor: Editor) => editor.view.dom.querySelectorAll('[class^="hljs-"]').length

describe('CodeBlockHighlight', () => {
  it('loads no grammars for a document without a code block', async () => {
    makeEditor('<p>const a = 1</p>')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mod.lowlight.listLanguages()).toEqual([])
  })

  it('highlights a code block the content arrived with, without an edit', async () => {
    const editor = makeEditor(
      '<pre><code class="language-js">const answer = 42\nfunction f() {}</code></pre>'
    )
    const onUpdate = vi.fn()
    editor.on('update', onUpdate)
    expect(highlighted(editor)).toBe(0)

    await mod.loadCodeLanguages()
    await vi.waitFor(() => expect(highlighted(editor)).toBeGreaterThan(0))

    expect(mod.lowlight.registered('ts')).toBe(true)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(undoDepth(editor.state)).toBe(0)
  })

  it('loads the grammars when a code block is created', async () => {
    const editor = makeEditor('<p></p>')
    editor.chain().setCodeBlock({ language: 'javascript' }).insertContent('const x = 1').run()

    await vi.waitFor(() => expect(highlighted(editor)).toBeGreaterThan(0))
    expect(mod.lowlight.listLanguages()).toContain('javascript')
  })
})
