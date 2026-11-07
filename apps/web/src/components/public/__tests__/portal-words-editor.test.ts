// @vitest-environment happy-dom
/**
 * Words edited where they sit in the designer's frame: the editor of their
 * kind on a copy of the element, what it says to the builder for the format
 * bar, and what the builder sends back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { editWordsInPlace, finishWords, openWords } from '../portal-words-editor'

const posted: Array<Record<string, unknown>> = []
const post = (message: Record<string, unknown>) => posted.push(message)

beforeEach(() => {
  posted.length = 0
})
afterEach(() => {
  finishWords()
  document.body.innerHTML = ''
})

function open(html: string): { element: HTMLElement; editor: Editor } {
  document.body.innerHTML = html
  const element = document.querySelector<HTMLElement>('[data-qb-words]')!
  editWordsInPlace(element, post)
  const dom = document.querySelector('[data-qb-words-editing] .ProseMirror') as HTMLElement & {
    editor: Editor
  }
  return { element, editor: dom?.editor }
}

/** A message the builder sends the frame. */
const send = (data: Record<string, unknown>) =>
  window.dispatchEvent(
    new MessageEvent('message', { data, origin: window.location.origin, source: window.parent })
  )

const states = () => posted.filter((m) => m.type === 'quackback:words-state')

describe('editing words where they sit', () => {
  it('keeps the element’s own classes and reads its accent phrase as a mark', () => {
    const { editor } = open(
      '<h1 class="big" data-qb-words="home.title">Help shape <span data-qb-accent="muted">Acme</span></h1>'
    )
    const copy = document.querySelector('[data-qb-words-editing]')!
    expect(copy.className).toBe('big')
    expect(copy.tagName).toBe('H1')
    expect(editor.getJSON().content![0]!.content).toEqual([
      { type: 'text', text: 'Help shape ' },
      {
        type: 'text',
        text: 'Acme',
        marks: [{ type: 'accent', attrs: { style: 'muted', colour: null } }],
      },
    ])
  })

  it('says what the format bar needs: the words selected, their box and the marks on them', () => {
    open('<h1 data-qb-words="home.title">Help shape Acme</h1>')
    const last = states().at(-1)!
    expect(last.field).toBe('home.title')
    expect(last.state).toMatchObject({ kind: 'headline', selected: true, accent: null, limit: 280 })
    expect(last.selection).toBeTruthy()
    expect(last.box).toBeTruthy()
  })

  it('applies what the builder’s format bar asks, and sends the words on Enter', () => {
    const { editor } = open('<h1 data-qb-words="home.title">Help shape Acme</h1>')
    editor.commands.setTextSelection({ from: 12, to: 16 })
    send({ type: 'quackback:words-command', command: { type: 'accent', style: 'highlight' } })
    expect((states().at(-1)!.state as { accent: string }).accent).toBe('highlight')
    send({ type: 'quackback:words-finish', keep: true })
    const words = posted.find((m) => m.type === 'quackback:preview-words')!
    expect(JSON.stringify(words.doc)).toContain('"style":"highlight"')
    expect(posted.at(-1)).toEqual({ type: 'quackback:words-end', field: 'home.title' })
  })

  it('edits plain words as plain text, with no marks', () => {
    const { editor } = open('<h2 data-qb-words="block-ideas00001.heading">Top <b>posts</b></h2>')
    expect(Object.keys(editor.schema.marks)).toEqual([])
    expect(editor.getText()).toBe('Top posts')
  })

  it('edits a Welcome body as rich words, and leaves one with images to the panel', () => {
    const { editor } = open(
      '<div class="prose" data-qb-words="block-welcome001.body"><p><strong>Hi</strong> <a href="https://a.co">there</a></p><ul><li><p>One</p></li></ul></div>'
    )
    expect(editor.getHTML()).toContain('<strong>Hi</strong>')
    expect(editor.getHTML()).toContain('<ul>')
    finishWords()
    posted.length = 0
    const blocked = open(
      '<div data-qb-words="block-welcome001.body"><p>Hi</p><img src="x.png"></div>'
    )
    expect(blocked.editor).toBeUndefined()
    expect(posted).toEqual([{ type: 'quackback:words-blocked', field: 'block-welcome001.body' }])
  })

  it('edits a Welcome body with H2 and H3 headings in place, and leaves other levels to the panel', () => {
    const { editor } = open(
      '<div data-qb-words="feedback.welcome"><h2 id="how" style="text-align: center">How</h2><h3 id="v">Vote</h3><p>Hi</p></div>'
    )
    expect(editor.getHTML()).toContain('<h2 style="text-align: center;">How</h2><h3>Vote</h3>')
    finishWords()
    posted.length = 0
    const blocked = open('<div data-qb-words="feedback.welcome"><h4>Small</h4><p>Hi</p></div>')
    expect(blocked.editor).toBeUndefined()
  })

  it('asks the builder for a link address on Mod-K', () => {
    const { editor } = open('<div data-qb-words="feedback.welcome"><p>Read the docs</p></div>')
    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
    )
    expect(posted).toContainEqual({ type: 'quackback:words-link', field: 'feedback.welcome' })
  })

  it('sends nothing when the words are kept unchanged', () => {
    open('<h1 data-qb-words="home.title">Same</h1>')
    vi.useFakeTimers()
    send({ type: 'quackback:words-finish', keep: true })
    vi.useRealTimers()
    expect(posted.some((m) => m.type === 'quackback:preview-words')).toBe(false)
  })
})

describe('editing the words the design stores', () => {
  const editorOf = () =>
    (
      document.querySelector('[data-qb-words-editing] .ProseMirror') as
        (HTMLElement & { editor: Editor }) | null
    )?.editor
  const stored = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Shape ' },
          {
            type: 'text',
            text: 'Acme',
            marks: [{ type: 'accent', attrs: { style: 'highlight' } }],
          },
        ],
      },
    ],
  }

  it('asks the builder for them and edits them, not the page’s HTML', () => {
    document.body.innerHTML = '<h1 data-qb-words="home.title">Something else <b>drawn</b></h1>'
    openWords(document.querySelector<HTMLElement>('[data-qb-words]')!, post)
    expect(posted).toContainEqual({ type: 'quackback:words-ask', field: 'home.title' })
    expect(editorOf()).toBeUndefined()
    send({ type: 'quackback:words-open', field: 'home.title', doc: stored })
    expect(editorOf()!.getJSON().content![0]!.content).toEqual([
      { type: 'text', text: 'Shape ' },
      {
        type: 'text',
        text: 'Acme',
        marks: [{ type: 'accent', attrs: { style: 'highlight', colour: null } }],
      },
    ])
  })

  it('reads the page’s words when the builder has none', () => {
    document.body.innerHTML = '<h1 data-qb-words="home.title">Drawn words</h1>'
    openWords(document.querySelector<HTMLElement>('[data-qb-words]')!, post)
    send({ type: 'quackback:words-open', field: 'home.title', doc: null })
    expect(editorOf()!.getText()).toBe('Drawn words')
  })

  it('takes stored words only from the builder, and reads the page’s when none come', () => {
    vi.useFakeTimers()
    try {
      document.body.innerHTML = '<h1 data-qb-words="home.title">Drawn words</h1>'
      openWords(document.querySelector<HTMLElement>('[data-qb-words]')!, post, 50)
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'quackback:words-open', field: 'home.title', doc: stored },
          origin: 'https://elsewhere.example',
          source: window.parent,
        })
      )
      expect(editorOf()).toBeUndefined()
      vi.advanceTimersByTime(60)
      expect(editorOf()!.getText()).toBe('Drawn words')
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves stored rich words with more than words to the panel, whatever the page draws', () => {
    document.body.innerHTML = '<div data-qb-words="feedback.welcome"><p>Hi</p></div>'
    editWordsInPlace(document.querySelector<HTMLElement>('[data-qb-words]')!, post, {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'https://cdn.example/a.png' } }],
    })
    expect(posted).toContainEqual({ type: 'quackback:words-blocked', field: 'feedback.welcome' })
    expect(editorOf()).toBeUndefined()
  })
})
