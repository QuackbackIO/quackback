/**
 * Rich words gain headings (H2, H3), alignment and colours from the brand's
 * colour roles; a headline's accent phrase gains a colour role. Nothing else
 * gets through: other heading levels, free colours and unknown alignments are
 * cut as before.
 */
import { describe, expect, it } from 'vitest'
import {
  fitDoc,
  headlineDoc,
  headlineFromDoc,
  readHeadlineMarkup,
  readRichMarkdown,
  richMarkdown,
  wordsColour,
  type WordsDoc,
} from '../rich-words'
import { isValidWords } from '../words-schema'
import { defaultDesign, portalDesign } from '../schema'
import { setHeadline, setWordsDoc, wordsDocOf } from '../headline-words'

const text = (words: string, marks?: object[]) =>
  marks ? { type: 'text', text: words, marks } : { type: 'text', text: words }
const colour = (role: string) => ({ type: 'colour', attrs: { role } })
const doc = (...content: object[]) => ({ type: 'doc', content }) as WordsDoc

const rich = doc(
  { type: 'heading', attrs: { level: 2 }, content: [text('How it works')] },
  { type: 'heading', attrs: { level: 3, textAlign: 'center' }, content: [text('Voting')] },
  {
    type: 'paragraph',
    attrs: { textAlign: 'end' },
    content: [text('Vote for '), text('what matters', [colour('support'), { type: 'bold' }])],
  }
)

describe('rich words: headings, alignment and colour roles', () => {
  it('fit rich words', () => {
    expect(isValidWords(rich, 'rich')).toBe(true)
    expect(fitDoc(rich, 'rich')).toEqual(rich)
  })

  it('keep only H2 and H3: other levels are words, as before', () => {
    const levels = doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('One')] },
      { type: 'heading', attrs: { level: 4 }, content: [text('Four')] }
    )
    expect(isValidWords(levels, 'rich')).toBe(false)
    expect(fitDoc(levels, 'rich')).toEqual(
      doc(
        { type: 'paragraph', content: [text('One')] },
        { type: 'paragraph', content: [text('Four')] }
      )
    )
  })

  it('align to the start, centre or end only; start is left unset', () => {
    const odd = doc({ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [text('x')] })
    expect(isValidWords(odd, 'rich')).toBe(false)
    expect(fitDoc(odd, 'rich')).toEqual(doc({ type: 'paragraph', content: [text('x')] }))
    expect(
      fitDoc(
        doc({ type: 'paragraph', attrs: { textAlign: 'start' }, content: [text('x')] }),
        'rich'
      )
    ).toEqual(doc({ type: 'paragraph', content: [text('x')] }))
  })

  it('colour words in a brand colour role, never a free colour', () => {
    const free = doc({ type: 'paragraph', content: [text('x', [colour('#ff0000')])] })
    expect(isValidWords(free, 'rich')).toBe(false)
    expect(fitDoc(free, 'rich')).toEqual(doc({ type: 'paragraph', content: [text('x')] }))
    for (const role of ['accent', 'support', 'extra1', 'extra2'])
      expect(
        isValidWords(doc({ type: 'paragraph', content: [text('x', [colour(role)])] }), 'rich')
      ).toBe(true)
  })

  it('leave plain words and headlines without them', () => {
    expect(fitDoc(rich, 'plain')).toEqual(
      doc({ type: 'paragraph', content: [text('How it works Voting Vote for what matters')] })
    )
  })

  it('read and write headings as markdown', () => {
    const read = readRichMarkdown('## How it works\n\n### Voting\n\nWords')
    expect(read).toEqual({
      ok: true,
      doc: doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('How it works')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('Voting')] },
        { type: 'paragraph', content: [text('Words')] }
      ),
    })
    if (read.ok) expect(richMarkdown(read.doc)).toBe('## How it works\n\n### Voting\n\nWords')
  })

  it('draw each colour from the design, with the brand colour where it has none', () => {
    expect(wordsColour('support')).toBe(
      'var(--qb-words-support, var(--qb-role-support, var(--qb-accent-text, var(--primary))))'
    )
    expect(wordsColour('accent')).toBe(
      'var(--qb-words-accent, var(--qb-accent-text, var(--primary)))'
    )
  })

  it('are kept by the design', () => {
    const design = defaultDesign()
    design.pages.feedback.welcome.body = rich as never
    expect(portalDesign.parse(design).pages.feedback.welcome.body).toEqual(rich)
  })
})

describe('a headline accent’s colour role', () => {
  const words = {
    title: 'Help shape what Acme grows into',
    accent: { text: 'Acme', style: 'colour' as const, colour: 'support' as const },
  }

  it('is an attribute of the accent mark, read back', () => {
    const made = headlineDoc(words)
    expect(made.content?.[0]?.content?.[1]).toEqual(
      text('Acme', [{ type: 'accent', attrs: { style: 'colour', colour: 'support' } }])
    )
    expect(headlineFromDoc(made)).toEqual(words)
  })

  it('is the brand colour when unset or unknown', () => {
    const plain = headlineDoc({ ...words, accent: { text: 'Acme', style: 'colour' } })
    expect(plain.content?.[0]?.content?.[1]).toEqual(
      text('Acme', [{ type: 'accent', attrs: { style: 'colour' } }])
    )
    const odd = doc({
      type: 'paragraph',
      content: [text('Acme', [{ type: 'accent', attrs: { style: 'colour', colour: 'pink' } }])],
    })
    expect(headlineFromDoc(odd).accent).toEqual({ text: 'Acme', style: 'colour' })
  })

  it('is written to the design and cleared again', () => {
    const design = defaultDesign()
    const field = { kind: 'page', page: 'home', part: 'title' } as const
    setWordsDoc(design, field, 'en', headlineDoc(words))
    expect(design.pages.home.headline?.accent).toEqual({
      style: 'colour',
      colour: 'support',
      text: { en: 'Acme' },
    })
    expect(portalDesign.parse(design).pages.home.headline?.accent?.colour).toBe('support')
    expect(wordsDocOf(design, field, 'en')).toEqual(headlineDoc(words))
    setWordsDoc(
      design,
      field,
      'en',
      headlineDoc({ ...words, accent: { text: 'Acme', style: 'colour' } })
    )
    expect(design.pages.home.headline?.accent).toEqual({ style: 'colour', text: { en: 'Acme' } })
  })

  it('stays when words come from markup, which does not name it', () => {
    const design = defaultDesign()
    setHeadline(design, 'home', 'en', words)
    const read = readHeadlineMarkup('Help shape what [Acme]{highlight} grows into')
    if (!read.ok) throw new Error(read.refusal)
    setHeadline(design, 'home', 'en', read.words)
    expect(design.pages.home.headline?.accent).toEqual({
      style: 'highlight',
      colour: 'support',
      text: { en: 'Acme' },
    })
  })

  it('is refused by the design when it is not a colour role', () => {
    const design = defaultDesign()
    setHeadline(design, 'home', 'en', words)
    ;(design.pages.home.headline!.accent as { colour: string }).colour = '#f00'
    expect(portalDesign.safeParse(design).success).toBe(false)
  })
})
