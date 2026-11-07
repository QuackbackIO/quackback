// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import type { WordsKind } from '@/lib/shared/design/rich-words'
import { fitDoc, headlineDoc, headlineFromDoc, type WordsDoc } from '@/lib/shared/design/rich-words'
import { generateContentHTML } from '@/lib/shared/content-html'
import {
  cutToLimit,
  hrefOf,
  withinLimit,
  runWordsCommand,
  wordsExtensions,
  wordsState,
  type WordsEditorOptions,
} from '../extensions'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function make(
  kind: WordsKind,
  content: object | string,
  options: Partial<WordsEditorOptions> = {}
) {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    content,
    extensions: wordsExtensions({ kind, ...options }),
  })
  editors.push(editor)
  return editor
}

const json = (editor: Editor) => editor.getJSON() as WordsDoc

/** Selects the first place a phrase is in the editor's words. */
function select(editor: Editor, phrase: string) {
  let at = -1
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text!.includes(phrase)) at = pos + node.text!.indexOf(phrase)
  })
  editor.commands.setTextSelection({ from: at, to: at + phrase.length })
}

const press = (editor: Editor, key: string, init: KeyboardEventInit = {}) =>
  editor.view.someProp('handleKeyDown', (handle) =>
    handle(editor.view, new KeyboardEvent('keydown', { key, ...init }))
  )

describe('each kind’s schema', () => {
  it('holds only the marks and blocks its words allow', () => {
    const marks = (kind: WordsKind) => Object.keys(make(kind, '').schema.marks).sort()
    expect(marks('headline')).toEqual(['accent'])
    expect(marks('plain')).toEqual([])
    expect(marks('rich')).toEqual(['bold', 'colour', 'italic', 'link'])
    const nodes = Object.keys(make('rich', '').schema.nodes)
    expect(nodes).toEqual(
      expect.arrayContaining([
        'paragraph',
        'heading',
        'bulletList',
        'orderedList',
        'listItem',
        'hardBreak',
      ])
    )
    for (const node of ['image', 'codeBlock', 'blockquote', 'table'])
      expect(nodes).not.toContain(node)
    expect(Object.keys(make('headline', '').schema.nodes).sort()).toEqual([
      'doc',
      'paragraph',
      'text',
    ])
  })
})

describe('the accent mark', () => {
  it('reads the portal’s accent span and keeps one phrase per headline', () => {
    const editor = make(
      'headline',
      headlineDoc({ title: 'Help shape Acme', accent: { text: 'Acme', style: 'highlight' } })
    )
    expect(headlineFromDoc(json(editor)).accent).toEqual({ text: 'Acme', style: 'highlight' })
    select(editor, 'Help')
    runWordsCommand(editor, { type: 'accent', style: 'colour' })
    expect(headlineFromDoc(json(editor))).toEqual({
      title: 'Help shape Acme',
      accent: { text: 'Help', style: 'colour' },
    })
    expect(editor.getHTML()).toContain('data-qb-accent="colour"')
  })

  it('takes the style off when it is applied again, and says what is on', () => {
    const editor = make('headline', 'Build together')
    select(editor, 'together')
    runWordsCommand(editor, { type: 'accent', style: 'muted' })
    expect(wordsState(editor, 'headline', 280).accent).toBe('muted')
    runWordsCommand(editor, { type: 'accent', style: 'muted' })
    expect(headlineFromDoc(json(editor)).accent).toBeNull()
  })

  it('refuses a phrase over 60 characters', () => {
    const editor = make('headline', 'a'.repeat(80))
    editor.commands.setTextSelection({ from: 1, to: 70 })
    expect(runWordsCommand(editor, { type: 'accent', style: 'colour' })).toBe(false)
  })
})

describe('keys', () => {
  it('keeps a line on Enter and cancels on Escape', () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const editor = make('plain', 'Hello', { onCommit, onCancel })
    press(editor, 'Enter')
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(editor.getText()).toBe('Hello')
    press(editor, 'Escape')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('gives rich words new paragraphs on Enter, keeps them on Mod-Enter, and asks for a link on Mod-K', () => {
    const onCommit = vi.fn()
    const onLinkRequest = vi.fn()
    const editor = make('rich', '<p>Hello</p>', { onCommit, onLinkRequest })
    editor.commands.focus('end')
    press(editor, 'Enter')
    expect(onCommit).not.toHaveBeenCalled()
    expect(json(editor).content).toHaveLength(2)
    press(editor, 'Enter', { ctrlKey: true })
    press(editor, 'k', { ctrlKey: true })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onLinkRequest).toHaveBeenCalledTimes(1)
  })

  it('bolds and italicises with Mod-B and Mod-I in rich words', () => {
    const editor = make('rich', '<p>Hello there</p>')
    select(editor, 'Hello')
    press(editor, 'b', { ctrlKey: true })
    press(editor, 'i', { ctrlKey: true })
    expect(json(editor).content![0]!.content![0]).toEqual({
      type: 'text',
      text: 'Hello',
      marks: [{ type: 'bold' }, { type: 'italic' }],
    })
  })
})

describe('pasting', () => {
  const styled =
    '<h1 style="font-family:Comic Sans">Big <span style="color:red">news</span></h1>' +
    '<p><b>Bold</b> and <a href="https://acme.com">a link</a> and <a href="javascript:alert(1)">bad</a></p>' +
    '<img src="x.png"><ul><li>One</li></ul>'

  it('keeps rich words’ marks, lists and safe links, and drops styles, other headings and images', () => {
    const editor = make('rich', '')
    editor.view.pasteHTML(styled)
    const html = editor.getHTML()
    expect(html).not.toMatch(/style=|<h1|<img|javascript:|font-family|color/)
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('href="https://acme.com"')
    expect(html).toContain('<ul>')
    expect(editor.getText()).toContain('Big news')
  })

  it('makes a paste into a line one line of its words, cut to the limit', () => {
    const editor = make('headline', headlineDoc({ title: 'Hi ', accent: null }), { limit: 20 })
    editor.commands.focus('end')
    editor.view.pasteHTML(styled)
    expect(json(editor).content).toHaveLength(1)
    expect(editor.getText()).toBe('Hi Big news Bold and')
    expect(Object.keys(editor.getJSON().content![0]!.content![0]!)).not.toContain('marks')
  })
})

describe('limits', () => {
  it('lets no typing pass the limit', () => {
    const editor = make('plain', 'abcd', { limit: 5 })
    editor.commands.focus('end')
    editor.commands.insertContent('xyz')
    expect(editor.getText()).toBe('abcd')
    editor.commands.insertContent('x')
    expect(editor.getText()).toBe('abcdx')
    expect(wordsState(editor, 'plain', 5)).toMatchObject({ length: 5, limit: 5 })
  })
})

describe('links', () => {
  it('sets only web and email links', () => {
    const editor = make('rich', '<p>Read the docs</p>')
    select(editor, 'docs')
    expect(runWordsCommand(editor, { type: 'link', href: 'javascript:alert(1)' })).toBe(false)
    runWordsCommand(editor, { type: 'link', href: 'https://acme.com/docs' })
    expect(wordsState(editor, 'rich', null).link).toBe('https://acme.com/docs')
  })

  it('reads an address as typed', () => {
    expect(hrefOf('acme.com/docs')).toBe('https://acme.com/docs')
    expect(hrefOf('hi@acme.com')).toBe('mailto:hi@acme.com')
    expect(hrefOf('https://acme.com')).toBe('https://acme.com')
    expect(hrefOf('not a link')).toBeNull()
  })
})

describe('headings, alignment and colours in rich words', () => {
  const body = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 2, textAlign: 'center' },
        content: [{ type: 'text', text: 'How it works' }],
      },
      {
        type: 'paragraph',
        attrs: { textAlign: 'end' },
        content: [
          { type: 'text', text: 'Vote for ' },
          {
            type: 'text',
            text: 'what matters',
            marks: [{ type: 'bold' }, { type: 'colour', attrs: { role: 'support' } }],
          },
        ],
      },
    ],
  } as WordsDoc

  it('reads them back from the portal’s own HTML', () => {
    const editor = make('rich', generateContentHTML(body as never))
    expect(fitDoc(json(editor), 'rich')).toEqual(body)
  })

  it('sets a heading and back, keeping where the block sits', () => {
    const editor = make('rich', '<p style="text-align: center">Hello there</p>')
    select(editor, 'Hello')
    runWordsCommand(editor, { type: 'heading', level: 3 })
    expect(wordsState(editor, 'rich', null)).toMatchObject({ heading: 3, align: 'center' })
    expect(json(editor).content![0]).toMatchObject({
      type: 'heading',
      attrs: { level: 3, textAlign: 'center' },
    })
    runWordsCommand(editor, { type: 'heading', level: 0 })
    expect(json(editor).content![0]).toMatchObject({
      type: 'paragraph',
      attrs: { textAlign: 'center' },
    })
  })

  it('aligns to the centre, the end and back to the start', () => {
    const editor = make('rich', '<p>Hello</p>')
    select(editor, 'Hello')
    runWordsCommand(editor, { type: 'align', align: 'end' })
    expect(wordsState(editor, 'rich', null).align).toBe('end')
    expect(editor.getHTML()).toBe('<p style="text-align: end;">Hello</p>')
    runWordsCommand(editor, { type: 'align', align: 'start' })
    expect(editor.getHTML()).toBe('<p>Hello</p>')
  })

  it('colours words in a role and takes it off', () => {
    const editor = make('rich', '<p>Hello there</p>')
    select(editor, 'there')
    runWordsCommand(editor, { type: 'colour', role: 'extra1' })
    expect(wordsState(editor, 'rich', null).colour).toBe('extra1')
    expect(editor.getHTML()).toContain(
      '<span data-qb-colour="extra1" style="color: var(--qb-words-extra1'
    )
    runWordsCommand(editor, { type: 'colour', role: null })
    expect(editor.getHTML()).toBe('<p>Hello there</p>')
  })

  it('never takes a free colour or a font size from a paste', () => {
    const editor = make('rich', '')
    editor.view.pasteHTML(
      '<p><span style="color:#f00;font-size:40px">Red</span> <span data-qb-colour="pink">x</span></p>'
    )
    expect(editor.getHTML()).toBe('<p>Red x</p>')
  })
})

describe('the accent’s colour role', () => {
  it('draws the phrase in a role, keeps it as the phrase moves, and goes back to the brand colour', () => {
    const editor = make(
      'headline',
      headlineDoc({ title: 'Help shape Acme', accent: { text: 'Acme', style: 'colour' } })
    )
    expect(wordsState(editor, 'headline', 280).accentColour).toBeNull()
    runWordsCommand(editor, { type: 'accentColour', role: 'support' })
    expect(wordsState(editor, 'headline', 280).accentColour).toBe('support')
    expect(headlineFromDoc(json(editor)).accent).toEqual({
      text: 'Acme',
      style: 'colour',
      colour: 'support',
    })
    expect(editor.getHTML()).toContain('data-qb-accent-colour="support"')
    select(editor, 'Help')
    runWordsCommand(editor, { type: 'accent', style: 'highlight' })
    expect(headlineFromDoc(json(editor)).accent).toEqual({
      text: 'Help',
      style: 'highlight',
      colour: 'support',
    })
    runWordsCommand(editor, { type: 'accentColour', role: 'accent' })
    expect(headlineFromDoc(json(editor)).accent).toEqual({ text: 'Help', style: 'highlight' })
  })

  it('reads the portal’s accent in a role', () => {
    const editor = make(
      'headline',
      '<p>Shape <span data-qb-accent="colour" data-qb-accent-colour="extra2">Acme</span></p>'
    )
    expect(headlineFromDoc(json(editor)).accent).toEqual({
      text: 'Acme',
      style: 'colour',
      colour: 'extra2',
    })
  })

  it('needs a phrase set apart', () => {
    const editor = make('headline', 'Plain words')
    expect(runWordsCommand(editor, { type: 'accentColour', role: 'support' })).toBe(false)
  })
})

describe('limits while an input method composes', () => {
  /** A change that types words at the end of the editor's words. */
  const typing = (editor: Editor, words: string) =>
    editor.state.tr.insertText(words, editor.state.doc.content.size - 1)

  it('refuses a change past the limit, but never one made while composing', () => {
    const editor = make('plain', 'abcd', { limit: 5 })
    const tr = typing(editor, 'xyz')
    expect(withinLimit(tr, editor.state, 5, false)).toBe(false)
    expect(withinLimit(tr, editor.state, 5, true)).toBe(true)
    expect(withinLimit(typing(editor, 'x'), editor.state, 5, false)).toBe(true)
    // The composition's own changes, even the last one, after it ends.
    expect(
      withinLimit(typing(editor, 'xyz').setMeta('composition', 1), editor.state, 5, false)
    ).toBe(true)
  })

  it('cuts composed words over the limit from just before the cursor', () => {
    const editor = make('plain', 'abcd', { limit: 5 })
    editor.view.dispatch(typing(editor, 'xyz').setMeta('composition', 1))
    // Kept while composing, then cut once it ends: what came in last goes.
    expect(editor.getText()).toBe('abcdx')
    const middle = make('plain', 'abXYZcd')
    middle.commands.setTextSelection(6)
    middle.view.dispatch(cutToLimit(middle.state, 5)!)
    expect(middle.getText()).toBe('abXcd')
    // With no room before the cursor, from the end.
    const words = make('plain', 'abcdxyz')
    words.commands.setTextSelection(1)
    words.view.dispatch(cutToLimit(words.state, 5)!)
    expect(words.getText()).toBe('abcdx')
  })

  it('cuts nothing within the limit', () => {
    const editor = make('plain', 'abc', { limit: 5 })
    expect(cutToLimit(editor.state, 5)).toBeNull()
  })

  it('keeps words over the limit while composing, and cuts them when it ends', async () => {
    const editor = make('headline', 'abcd', { limit: 5 })
    const input = (editor.view as unknown as { input: { composing: boolean } }).input
    input.composing = true
    editor.view.dispatch(typing(editor, 'xyz'))
    expect(editor.getText()).toBe('abcdxyz')
    input.composing = false
    editor.view.dom.dispatchEvent(new Event('compositionend'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(editor.getText()).toBe('abcdx')
  })
})
