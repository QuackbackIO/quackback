// @vitest-environment happy-dom
/**
 * Words edited on the canvas are read back from the portal's own HTML, so
 * every kind of words, and every mark and block it allows, must come back
 * from the page as the design keeps it. Words that came back different
 * would change the moment someone opened them on the canvas, with nothing
 * typed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { accented } from '@/components/public/portal-band'
import { ACCENT_CLASS } from '@/lib/shared/design/accent-class'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { generateContentHTML } from '@/lib/shared/content-html'
import {
  fitDoc,
  headlineDoc,
  plainDoc,
  sameWords,
  type AccentStyle,
  type ColourRole,
  type HeadlineWords,
  type WordsDoc,
  type WordsKind,
  type WordsNode,
} from '@/lib/shared/design/rich-words'
import { wordsToEdit } from '@/components/public/portal-words-editor'
import { wordsExtensions } from '@/lib/shared/words-editor/extensions'

const editors: Editor[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

/** The words as the canvas editor reads them from the page's element. */
function readBack(kind: WordsKind, html: string): WordsDoc {
  const page = document.createElement('h1')
  page.innerHTML = html
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    content: wordsToEdit(page, kind),
    extensions: wordsExtensions({ kind }),
  })
  editors.push(editor)
  return editor.getJSON() as WordsDoc
}

const expectSame = (kind: WordsKind, doc: WordsDoc, html: string) => {
  const back = readBack(kind, html)
  expect(sameWords(fitDoc(back, kind), fitDoc(doc, kind)), JSON.stringify(back)).toBe(true)
}

const STYLES = Object.keys(ACCENT_CLASS) as AccentStyle[]
const ROLES = DESIGN_OPTIONS.colourRole as readonly ColourRole[]

describe('a headline, read back from the portal', () => {
  const headlines: HeadlineWords[] = [
    { title: 'Got an idea for us?', accent: null },
    ...STYLES.flatMap((style) =>
      [undefined, ...ROLES].map((colour) => ({
        title: 'Got an idea for us?',
        accent: { text: 'an idea', style, ...(colour ? { colour } : {}) },
      }))
    ),
    { title: 'Hej! What should we make?', accent: { text: 'Hej!', style: 'colour' } },
    { title: 'What should we make next', accent: { text: 'next', style: 'highlight' } },
  ]

  it.each(headlines.map((words) => [JSON.stringify(words.accent), words] as const))(
    'keeps %s',
    (_, words) => {
      const { title, accent } = words
      const html = renderToStaticMarkup(
        createElement(Fragment, null, accented(title, accent?.text, accent?.style, accent?.colour))
      )
      expectSame('headline', headlineDoc(words), html)
    }
  )
})

describe('plain words, read back from the portal', () => {
  it.each(['Tell us what to improve', 'Ideas & fixes <welcome>', 'We <3 ideas', ''])(
    'keeps "%s"',
    (text) => {
      expectSame('plain', plainDoc(text), renderToStaticMarkup(createElement(Fragment, null, text)))
    }
  )
})

const text = (words: string, marks?: WordsNode['marks']): WordsNode =>
  marks ? { type: 'text', text: words, marks } : { type: 'text', text: words }
const para = (content: WordsNode[], textAlign?: string): WordsNode => ({
  type: 'paragraph',
  ...(textAlign ? { attrs: { textAlign } } : {}),
  content,
})
const doc = (...content: WordsNode[]): WordsDoc => ({ type: 'doc', content })

describe('rich words, read back from the portal', () => {
  const bodies: Array<[string, WordsDoc]> = [
    ['paragraphs', doc(para([text('Share an idea.')]), para([text('Vote on the rest.')]))],
    [
      'bold and italic',
      doc(
        para([
          text('Vote', [{ type: 'bold' }]),
          text(' or '),
          text('share', [{ type: 'italic' }]),
          text(' both', [{ type: 'bold' }, { type: 'italic' }]),
        ])
      ),
    ],
    [
      'a web link',
      doc(
        para([
          text('Read '),
          text('the guide', [{ type: 'link', attrs: { href: 'https://acme.example/guide' } }]),
        ])
      ),
    ],
    [
      'an email link',
      doc(
        para([
          text('Write to '),
          text('us', [{ type: 'link', attrs: { href: 'mailto:hi@acme.example' } }]),
        ])
      ),
    ],
    ...ROLES.map((role): [string, WordsDoc] => [
      `words in ${role}`,
      doc(para([text('Ideas '), text('welcome', [{ type: 'colour', attrs: { role } }])])),
    ]),
    [
      'bold words in a colour',
      doc(para([text('loud', [{ type: 'bold' }, { type: 'colour', attrs: { role: 'support' } }])])),
    ],
    [
      'a link in a colour',
      doc(
        para([
          text('help', [
            { type: 'link', attrs: { href: 'https://acme.example/' } },
            { type: 'colour', attrs: { role: 'extra1' } },
          ]),
        ])
      ),
    ],
    ...[2, 3].flatMap((level) =>
      [undefined, 'center', 'end'].map((textAlign): [string, WordsDoc] => [
        `an H${level} set to ${textAlign ?? 'the start'}`,
        doc(
          {
            type: 'heading',
            attrs: { level, ...(textAlign ? { textAlign } : {}) },
            content: [text('How it works')],
          },
          para([text('Ideas first.')])
        ),
      ])
    ),
    ['a paragraph in the centre', doc(para([text('Centred')], 'center'))],
    ['a paragraph at the end', doc(para([text('At the end')], 'end'))],
    ['a line break', doc(para([text('One'), { type: 'hardBreak' }, text('two')]))],
    ...(['bulletList', 'orderedList'] as const).map((type): [string, WordsDoc] => [
      `a ${type}`,
      doc({
        type,
        ...(type === 'orderedList' ? { attrs: { start: 1 } } : {}),
        content: [
          { type: 'listItem', content: [para([text('Share', [{ type: 'bold' }])])] },
          { type: 'listItem', content: [para([text('Vote')])] },
        ],
      }),
    ]),
  ]

  it.each(bodies)('keeps %s', (_, body) => {
    expectSame('rich', body, generateContentHTML(body as never))
  })
})
