/**
 * Each kind of words has one schema, built from the words editor's own
 * extensions. Words the schema refuses are never kept: they are fitted, and
 * the fitted words pass.
 */
import { describe, expect, it } from 'vitest'
import { DESIGN_OPTIONS } from '../options'
import { ACCENT_MAX, headlineDoc, sameWords, type WordsDoc, type WordsKind } from '../rich-words'
import {
  checkedWords,
  holdsMoreThanWords,
  isValidWords,
  wordsProblem,
  wordsSchema,
} from '../words-schema'

const text = (words: string, marks?: object[]) =>
  marks ? { type: 'text', text: words, marks } : { type: 'text', text: words }
const para = (content: object[], attrs?: object) => ({
  type: 'paragraph',
  ...(attrs ? { attrs } : {}),
  content,
})
const doc = (...content: object[]) => ({ type: 'doc', content }) as WordsDoc
const accent = (style: string, colour?: string) => ({
  type: 'accent',
  attrs: { style, ...(colour ? { colour } : {}) },
})
const KINDS: WordsKind[] = ['headline', 'plain', 'rich']

describe('the schema of each kind', () => {
  it('comes from the editor: rich words hold blocks and marks, a line holds one paragraph', () => {
    const rich = wordsSchema('rich')
    expect(Object.keys(rich.marks).sort()).toEqual(['bold', 'colour', 'italic', 'link'])
    expect(rich.nodes.heading && rich.nodes.bulletList && rich.nodes.hardBreak).toBeTruthy()
    expect(Object.keys(wordsSchema('headline').marks)).toEqual(['accent'])
    expect(Object.keys(wordsSchema('plain').marks)).toEqual([])
    expect(wordsSchema('plain').nodes.heading).toBeUndefined()
  })

  it('holds what each kind may hold', () => {
    expect(
      isValidWords(
        headlineDoc({
          title: 'Got an idea?',
          accent: { text: 'an idea', style: 'highlight', colour: 'support' },
        }),
        'headline'
      )
    ).toBe(true)
    expect(isValidWords(doc(para([text('Ideas')])), 'plain')).toBe(true)
    expect(
      isValidWords(
        doc(
          { type: 'heading', attrs: { level: 3, textAlign: 'center' }, content: [text('How')] },
          para([text('Vote', [{ type: 'bold' }, { type: 'colour', attrs: { role: 'extra2' } }])], {
            textAlign: 'end',
          }),
          { type: 'bulletList', content: [{ type: 'listItem', content: [para([text('one')])] }] },
          para([text('mail', [{ type: 'link', attrs: { href: 'mailto:hi@acme.example' } }])])
        ),
        'rich'
      )
    ).toBe(true)
    for (const kind of KINDS) expect(isValidWords({ type: 'doc', content: [] }, kind)).toBe(true)
  })

  it.each([
    ['headline', 'two lines', doc(para([text('One')]), para([text('Two')]))],
    ['headline', 'bold words', doc(para([text('One', [{ type: 'bold' }])]))],
    ['headline', 'an unknown accent style', doc(para([text('One', [accent('glow')])]))],
    [
      'headline',
      'an accent in a free colour',
      doc(para([text('One', [accent('colour', '#f00')])])),
    ],
    ['plain', 'an accent', doc(para([text('One', [accent('colour')])]))],
    ['plain', 'a heading', doc({ type: 'heading', attrs: { level: 2 }, content: [text('x')] })],
    ['rich', 'an H1', doc({ type: 'heading', attrs: { level: 1 }, content: [text('x')] })],
    ['rich', 'a justified paragraph', doc(para([text('x')], { textAlign: 'justify' }))],
    [
      'rich',
      'a free colour',
      doc(para([text('x', [{ type: 'colour', attrs: { role: '#f00' } }])])),
    ],
    [
      'rich',
      'a script link',
      doc(para([text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])])),
    ],
    ['rich', 'an image', doc({ type: 'image', attrs: { src: 'https://cdn.example/a.png' } })],
    ['rich', 'words outside a block', doc(text('loose'))],
    ['rich', 'a list item outside a list', doc({ type: 'listItem', content: [para([text('x')])] })],
  ] as const)('refuses, in %s words, %s', (kind, _, words) => {
    expect(wordsProblem(words, kind)).toEqual(expect.any(String))
  })
})

describe('words checked as they enter the design', () => {
  const messy: WordsDoc[] = [
    doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Big', [{ type: 'bold' }])] },
      para([text('x')], { textAlign: 'justify' })
    ),
    doc(text('loose'), { type: 'listItem', content: [para([text('item')])] }),
    doc(
      { type: 'image', attrs: { src: 'x' } },
      { type: 'blockquote', content: [para([text('quoted', [{ type: 'strike' }])])] }
    ),
    doc(
      para([
        text('a', [accent('glow', '#f00')]),
        text('b', [{ type: 'colour', attrs: { role: 'nope' } }]),
      ])
    ),
    doc(para([text('run', [{ type: 'link', attrs: { href: 'javascript:x' } }])]), {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'heading', attrs: { level: 2 }, content: [text('h')] }],
        },
      ],
    }),
    doc(para([text('One', [accent('colour')]), text(' and '), text('two', [accent('muted')])])),
    { type: 'doc' },
  ]

  it.each(KINDS)('always leaves %s words the schema holds', (kind) => {
    for (const words of messy) expect(wordsProblem(checkedWords(words, kind), kind)).toBeNull()
  })

  it.each(KINDS)('leaves %s words the schema holds as they are', (kind) => {
    const words =
      kind === 'rich'
        ? doc(para([text('Vote', [{ type: 'italic' }])]), {
            type: 'heading',
            attrs: { level: 2 },
            content: [text('How')],
          })
        : kind === 'headline'
          ? headlineDoc({ title: 'Got an idea?', accent: { text: 'idea', style: 'colour' } })
          : doc(para([text('Ideas')]))
    expect(sameWords(checkedWords(words, kind), words)).toBe(true)
  })

  it('sets apart one phrase in a headline, of up to ACCENT_MAX characters', () => {
    const two = checkedWords(
      doc(para([text('One', [accent('colour')]), text(' and '), text('two', [accent('muted')])])),
      'headline'
    )
    expect(two).toEqual(doc(para([text('One', [accent('colour')]), text(' and two')])))
    const long = 'x'.repeat(ACCENT_MAX + 5)
    const cut = checkedWords(doc(para([text(long, [accent('highlight')])])), 'headline')
    expect(cut).toEqual(
      doc(para([text('x'.repeat(ACCENT_MAX), [accent('highlight')]), text('xxxxx')]))
    )
  })

  it('cuts a line to its limit', () => {
    expect(checkedWords(doc(para([text('Ideas welcome here')])), 'plain', 5)).toEqual(
      doc(para([text('Ideas')]))
    )
    expect(
      checkedWords(doc(para([text('Ab', [accent('colour')]), text('cdef')])), 'headline', 3)
    ).toEqual(doc(para([text('Ab', [accent('colour')]), text('c')])))
  })

  it('keeps colour roles and accent colours from the brand only', () => {
    for (const role of DESIGN_OPTIONS.colourRole)
      expect(
        isValidWords(doc(para([text('x', [{ type: 'colour', attrs: { role } }])])), 'rich')
      ).toBe(true)
  })
})

describe('words that hold more than the words editor', () => {
  it('are those with nodes, marks or headings the rich schema has no place for', () => {
    expect(holdsMoreThanWords(doc({ type: 'image', attrs: { src: 'x' } }))).toBe(true)
    expect(holdsMoreThanWords(doc(para([text('x', [{ type: 'underline' }])])))).toBe(true)
    expect(
      holdsMoreThanWords(doc({ type: 'heading', attrs: { level: 4 }, content: [text('x')] }))
    ).toBe(true)
    expect(
      holdsMoreThanWords(
        doc(para([text('x', [{ type: 'link', attrs: { href: 'javascript:x' } }])]))
      )
    ).toBe(false)
    expect(holdsMoreThanWords(doc(para([text('x')])))).toBe(false)
  })
})
