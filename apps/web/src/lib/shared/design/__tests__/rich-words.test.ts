import { describe, expect, it } from 'vitest'
import {
  docText,
  fitDoc,
  hasAccentMarkup,
  headlineDoc,
  headlineFromDoc,
  headlineMarkup,
  isAllowedHref,
  readHeadlineMarkup,
  readRichMarkdown,
  richMarkdown,
  type WordsDoc,
} from '../rich-words'
import { isValidWords } from '../words-schema'
import { defaultDesign } from '../schema'
import {
  readWordsField,
  setWordsDoc,
  wordsChangeLabel,
  wordsDocOf,
  wordsElsewhere,
  wordsKindOf,
} from '../headline-words'
import { newBlock } from '../home'

const accent = (text: string, style = 'colour') => ({
  type: 'text',
  text,
  marks: [{ type: 'accent', attrs: { style } }],
})
const line = (...content: object[]) =>
  ({ type: 'doc', content: [{ type: 'paragraph', content }] }) as WordsDoc

describe('the accent mark and the design fields', () => {
  it('reads a headline with its phrase as a mark on those words, and back', () => {
    const words = {
      title: 'Help shape what Acme grows into',
      accent: { text: 'Acme', style: 'colour' as const },
    }
    const doc = headlineDoc(words)
    expect(doc).toEqual(
      line({ type: 'text', text: 'Help shape what ' }, accent('Acme'), {
        type: 'text',
        text: ' grows into',
      })
    )
    expect(headlineFromDoc(doc)).toEqual(words)
  })

  it('keeps each look: Accent, Highlight and Lighter', () => {
    for (const style of ['colour', 'highlight', 'muted'] as const)
      expect(
        headlineFromDoc(line({ type: 'text', text: 'Build ' }, accent('together', style)))
      ).toEqual({ title: 'Build together', accent: { text: 'together', style } })
  })

  it('keeps one phrase apart: a second marked run stays plain words', () => {
    const doc = line(accent('One'), { type: 'text', text: ' and ' }, accent('two'))
    expect(headlineFromDoc(doc)).toEqual({
      title: 'One and two',
      accent: { text: 'One', style: 'colour' },
    })
  })

  it('reads a headline without a phrase, or a phrase it does not hold, as words alone', () => {
    expect(headlineFromDoc(line({ type: 'text', text: '  Hello   there ' }))).toEqual({
      title: 'Hello there',
      accent: null,
    })
    expect(headlineDoc({ title: 'Hello', accent: { text: 'bye', style: 'colour' } })).toEqual(
      line({ type: 'text', text: 'Hello' })
    )
  })

  it('cuts a phrase to 60 characters', () => {
    const long = 'a'.repeat(70)
    expect(headlineFromDoc(line(accent(long))).accent?.text).toHaveLength(60)
  })
})

describe('the headline markup', () => {
  it('writes and reads [phrase]{accent}, {highlight} and {lighter}', () => {
    expect(
      headlineMarkup({ title: 'Help shape Acme', accent: { text: 'Acme', style: 'muted' } })
    ).toBe('Help shape [Acme]{lighter}')
    expect(readHeadlineMarkup('Help shape [Acme]{highlight}')).toEqual({
      ok: true,
      words: { title: 'Help shape Acme', accent: { text: 'Acme', style: 'highlight' } },
    })
    expect(readHeadlineMarkup('Plain words')).toEqual({
      ok: true,
      words: { title: 'Plain words', accent: null },
    })
  })

  it('refuses two phrases, an unknown look and a phrase over 60 characters', () => {
    expect(readHeadlineMarkup('[A]{accent} and [B]{accent}').ok).toBe(false)
    expect(readHeadlineMarkup('[A]{bold}').ok).toBe(false)
    expect(readHeadlineMarkup(`[${'a'.repeat(61)}]{accent}`).ok).toBe(false)
  })

  it('tells markup from plain brackets', () => {
    expect(hasAccentMarkup('Our [beta]{accent}')).toBe(true)
    expect(hasAccentMarkup('Our [beta] program')).toBe(false)
  })
})

describe('rich words as markdown', () => {
  it('reads paragraphs, line breaks, bold, italic, links and lists, and writes them back', () => {
    const text =
      'Hi **there**, read *the* [docs](https://acme.com/docs).\nThanks\n\n- One\n- Two\n\n1. First'
    const read = readRichMarkdown(text)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.doc.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'bulletList',
      'orderedList',
    ])
    expect(read.doc.content![0]!.content).toContainEqual({
      type: 'text',
      text: 'docs',
      marks: [{ type: 'link', attrs: { href: 'https://acme.com/docs' } }],
    })
    expect(read.doc.content![0]!.content).toContainEqual({ type: 'hardBreak' })
    expect(richMarkdown(read.doc)).toBe(text)
  })

  it('refuses a link that is not a web or email address', () => {
    expect(readRichMarkdown('[x](javascript:alert(1))').ok).toBe(false)
    expect(readRichMarkdown('[x](/relative)').ok).toBe(false)
    expect(readRichMarkdown('[mail](mailto:hi@acme.com)').ok).toBe(true)
  })

  it('keeps words with a lone asterisk or underscore as they are', () => {
    const read = readRichMarkdown('2 * 3 = 6 and snake_case_name')
    expect(read.ok && docText(read.doc)).toBe('2 * 3 = 6 and snake_case_name')
  })
})

describe('fitting a document to its kind', () => {
  const styled = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Bold',
            marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'red' } }],
          },
          { type: 'hardBreak' },
          { type: 'text', text: 'bad', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] },
        ],
      },
      { type: 'image', attrs: { src: 'x' } },
    ],
  } as WordsDoc

  it('keeps what rich words hold and drops styles, unsafe links and images', () => {
    expect(fitDoc(styled, 'rich')).toEqual({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'bad' },
          ],
        },
      ],
    })
  })

  it('makes one plain line of anything for plain words, and keeps only the accent for a headline', () => {
    expect(fitDoc(styled, 'plain')).toEqual(line({ type: 'text', text: 'Title Bold bad' }))
    expect(
      fitDoc(
        line(accent('Hi'), { type: 'text', text: ' x', marks: [{ type: 'bold' }] }),
        'headline'
      )
    ).toEqual(line(accent('Hi'), { type: 'text', text: ' x' }))
    expect(fitDoc(line(accent('Hi')), 'plain')).toEqual(line({ type: 'text', text: 'Hi' }))
  })

  it('says whether a body fits the rich words the page editor holds', () => {
    expect(isValidWords(styled, 'rich')).toBe(false)
    const read = readRichMarkdown('**Hi** [x](https://a.co)\n\n- one')
    expect(read.ok && isValidWords(read.doc, 'rich')).toBe(true)
  })

  it('allows only web and email links', () => {
    expect(isAllowedHref('https://acme.com')).toBe(true)
    expect(isAllowedHref('mailto:a@b.co')).toBe(true)
    expect(isAllowedHref('javascript:alert(1)')).toBe(false)
    expect(isAllowedHref('data:text/html,x')).toBe(false)
  })
})

describe('words fields', () => {
  it('reads Welcome bodies and the feed’s welcome, each rich', () => {
    expect(readWordsField('block-welcome001.body')).toEqual({
      kind: 'block',
      id: 'welcome001',
      part: 'body',
    })
    expect(readWordsField('feedback.welcome')).toEqual({ kind: 'welcome' })
    expect(wordsKindOf({ kind: 'welcome' })).toBe('rich')
    expect(wordsKindOf({ kind: 'page', page: 'home', part: 'title' })).toBe('headline')
    expect(wordsKindOf({ kind: 'page', page: 'home', part: 'subtitle' })).toBe('plain')
    expect(wordsKindOf({ kind: 'block', id: 'welcome001' })).toBe('plain')
  })

  it('writes a headline document to its words and accent, in one language', () => {
    const design = defaultDesign()
    const field = { kind: 'page', page: 'home', part: 'title' } as const
    setWordsDoc(
      design,
      field,
      'en',
      line({ type: 'text', text: 'Shape ' }, accent('Acme', 'highlight'))
    )
    expect(design.pages.home.headline).toEqual({
      title: { en: 'Shape Acme' },
      subtitle: {},
      accent: { style: 'highlight', text: { en: 'Acme' } },
    })
    expect(wordsDocOf(design, field, 'en')).toEqual(
      line({ type: 'text', text: 'Shape ' }, accent('Acme', 'highlight'))
    )
    setWordsDoc(design, field, 'de', line({ type: 'text', text: 'Gestalte Acme' }))
    expect(wordsElsewhere(design, field, 'de')).toEqual([{ locale: 'en', text: 'Shape Acme' }])
    setWordsDoc(design, field, 'en', line({ type: 'text', text: 'Shape Acme' }))
    expect(design.pages.home.headline?.accent).toBeUndefined()
  })

  it('writes a Welcome block body cut to rich words', () => {
    const design = defaultDesign()
    design.pages.home.blocks = [{ ...newBlock('welcome'), id: 'welcome001' } as never]
    const field = { kind: 'block', id: 'welcome001', part: 'body' } as const
    setWordsDoc(design, field, 'en', {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hi', marks: [{ type: 'bold' }, { type: 'underline' }] }],
        },
      ],
    })
    expect(wordsDocOf(design, field, 'en')).toEqual(
      line({ type: 'text', text: 'Hi', marks: [{ type: 'bold' }] })
    )
  })

  it('names a change for its undo: words, accent or formatting', () => {
    const field = { kind: 'page', page: 'home', part: 'title' } as const
    const plain = line({ type: 'text', text: 'Shape Acme' })
    const marked = line({ type: 'text', text: 'Shape ' }, accent('Acme'))
    expect(wordsChangeLabel(field, plain, marked)).toBe('Headline: accent')
    // Each kind by the name the editor gives it, and taking one away says so.
    const lighter = line({ type: 'text', text: 'Shape ' }, accent('Acme', 'muted'))
    expect(wordsChangeLabel(field, plain, lighter)).toBe('Headline: lighter')
    const highlighted = line({ type: 'text', text: 'Shape ' }, accent('Acme', 'highlight'))
    expect(wordsChangeLabel(field, plain, highlighted)).toBe('Headline: highlight')
    expect(wordsChangeLabel(field, highlighted, plain)).toBe('Headline: no highlight')
    expect(wordsChangeLabel(field, plain, line({ type: 'text', text: 'Shape us' }))).toBe(
      'Headline: words'
    )
    const welcome = { kind: 'welcome' } as const
    expect(
      wordsChangeLabel(
        welcome,
        plain,
        line({ type: 'text', text: 'Shape Acme', marks: [{ type: 'bold' }] })
      )
    ).toBe('Welcome message: formatting')
  })
})
