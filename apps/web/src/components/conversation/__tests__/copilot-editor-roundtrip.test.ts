// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '@/components/ui/rich-text-editor'
import { generateContentHTML } from '@/lib/shared/content-html'
import { CONVERSATION_EDITOR_FEATURES } from '../conversation-editor-features'
import { appendAnswerToDraft, EMPTY_DRAFT } from '../composer-draft'

let editor: Editor | undefined
afterEach(() => editor?.destroy())

describe('Copilot editor round trip', () => {
  it('saves links, nested formatting, lists, quotes and code through the real composer schema', () => {
    const draft = appendAnswerToDraft(
      EMPTY_DRAFT,
      'Read [the **guide**](/hc/guide) [1].\n\n- Parent\n  - *Child*\n\n> Advice\n\n~~~js\narray[1]\n~~~'
    )
    editor = new Editor({
      extensions: buildExtensions(CONVERSATION_EDITOR_FEATURES, { placeholder: '' }),
      content: draft.json!,
      enableContentCheck: true,
    })
    editor.state.doc.check()
    const html = generateContentHTML(editor.getJSON())
    expect(html).toContain('href="/hc/guide"')
    const rendered = document.createElement('div')
    rendered.innerHTML = html
    expect(rendered.querySelector('strong a')?.textContent).toBe('guide')
    expect(html).toContain('<em>Child</em>')
    expect(rendered.querySelector('blockquote')?.textContent).toBe('Advice')
    expect(html).toContain('class="language-js"')
    expect(html).toContain('array[1]')
    expect(html).not.toContain(' [1].')
    expect(editor.getMarkdown()).toContain('/hc/guide')
  })

  it('keeps advanced answer text readable in the conversation schema', () => {
    const draft = appendAnswerToDraft(
      EMPTY_DRAFT,
      '# Heading\n\n- [x] Done\n\n| Plan | Cost |\n| --- | --- |\n| Cloud | Paid |\n\n![Screenshot](/shot.png)\n\n- ```sh\n  echo hi\n  ```\n\n> ---'
    )
    editor = new Editor({
      extensions: buildExtensions(CONVERSATION_EDITOR_FEATURES, { placeholder: '' }),
      content: draft.json!,
      enableContentCheck: true,
    })
    editor.state.doc.check()
    expect(editor.getText()).toContain('Heading')
    expect(editor.getText()).toContain('☑ Done')
    expect(editor.getText()).toContain('Cloud | Paid')
    expect(editor.getHTML()).toContain('href="/shot.png"')
    expect(editor.getText()).toContain('echo hi')
  })
})
