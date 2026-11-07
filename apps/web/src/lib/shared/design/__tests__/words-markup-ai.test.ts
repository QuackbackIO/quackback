/**
 * The markup Quackback AI reads and writes keeps what the builder's editor
 * sets: a paragraph's or heading's alignment, words in a brand colour role,
 * and the colour role of a headline's accent. A rewrite of words that have
 * them keeps them, because the markup the AI is shown carries them.
 */
import { describe, expect, it } from 'vitest'
import {
  hasAccentMarkup,
  headlineMarkup,
  readHeadlineMarkup,
  readRichMarkdown,
  richMarkdown,
  unmarked,
  type WordsDoc,
} from '../rich-words'
import { defaultDesign } from '../schema'
import { setHeadline } from '../headline-words'

const text = (words: string, marks?: object[]) =>
  marks ? { type: 'text', text: words, marks } : { type: 'text', text: words }
const colour = (role: string) => ({ type: 'colour', attrs: { role } })
const doc = (...content: object[]) => ({ type: 'doc', content }) as WordsDoc

describe('rich words markup', () => {
  it('writes and reads alignment as a trailing {center} or {end}', () => {
    const made = doc(
      { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [text('Hello')] },
      { type: 'paragraph', attrs: { textAlign: 'end' }, content: [text('Signed, the team')] },
      { type: 'paragraph', content: [text('Plain')] }
    )
    const markdown = richMarkdown(made)
    expect(markdown).toBe('## Hello {center}\n\nSigned, the team {end}\n\nPlain')
    expect(readRichMarkdown(markdown)).toEqual({ ok: true, doc: made })
  })

  it('reads "centre", "right" and "left" as people write them', () => {
    const read = readRichMarkdown('A {centre}\n\nB {right}\n\nC {left}')
    expect(read.ok && read.doc.content?.map((n) => n.attrs?.textAlign)).toEqual([
      'center',
      'end',
      undefined,
    ])
  })

  it('writes and reads words in a colour role as [words]{role}', () => {
    const made = doc({
      type: 'paragraph',
      content: [
        text('Tell us '),
        text('what to build', [colour('support')]),
        text(' and '),
        text('why', [{ type: 'bold' }, colour('accent')]),
      ],
    })
    const markdown = richMarkdown(made)
    expect(markdown).toBe('Tell us [what to build]{support} and [**why**]{accent}')
    const read = readRichMarkdown(markdown)
    expect(read.ok && richMarkdown(read.doc)).toBe(markdown)
    expect(read.ok && read.doc.content?.[0]?.content?.[1]).toEqual(
      text('what to build', [colour('support')])
    )
  })

  it('reads the colour role words people use', () => {
    const read = readRichMarkdown('[a]{brand} [b]{second} [c]{extra1}')
    const roles = read.ok
      ? (read.doc.content?.[0]?.content ?? []).flatMap((n) =>
          (n.marks ?? []).map((m) => m.attrs?.role)
        )
      : []
    expect(roles).toEqual(['accent', 'support', 'extra1'])
  })

  it('refuses a colour that is not one of the brand’s roles', () => {
    const read = readRichMarkdown('[a]{#ff0000}')
    expect(read.ok).toBe(false)
    expect(readRichMarkdown('[a]{purple}').ok).toBe(false)
  })

  it('keeps a link inside coloured words and a link’s own brackets apart', () => {
    const read = readRichMarkdown('Read [our docs](https://docs.example.com) now')
    expect(read.ok && richMarkdown(read.doc)).toBe('Read [our docs](https://docs.example.com) now')
  })
})

describe('headline markup with the accent’s colour role', () => {
  it('writes the role after the look when it is not the brand colour', () => {
    expect(
      headlineMarkup({
        title: 'Build it together',
        accent: { text: 'together', style: 'colour', colour: 'support' },
      })
    ).toBe('Build it [together]{accent:support}')
    expect(
      headlineMarkup({ title: 'Build it together', accent: { text: 'together', style: 'colour' } })
    ).toBe('Build it [together]{accent}')
  })

  it('reads the role back, and accent as the brand colour said out loud', () => {
    expect(readHeadlineMarkup('Build it [together]{highlight:extra1}')).toEqual({
      ok: true,
      words: {
        title: 'Build it together',
        accent: { text: 'together', style: 'highlight', colour: 'extra1' },
      },
    })
    expect(readHeadlineMarkup('Build it [together]{accent:second}')).toEqual({
      ok: true,
      words: {
        title: 'Build it together',
        accent: { text: 'together', style: 'colour', colour: 'support' },
      },
    })
    const brand = readHeadlineMarkup('Build it [together]{accent:brand}')
    expect(brand.ok && brand.words.accent?.colour).toBe('accent')
  })

  it('refuses a role the brand does not have', () => {
    expect(readHeadlineMarkup('Build it [together]{accent:purple}').ok).toBe(false)
  })

  it('is markup plain words may not carry, and comes off whole', () => {
    expect(hasAccentMarkup('Build it [together]{accent:support}')).toBe(true)
    expect(unmarked('Build it [together]{accent:support}')).toBe('Build it together')
  })

  it('keeps the design’s role where the markup leaves it out, and clears it when told', () => {
    const draft = defaultDesign()
    draft.pages.home.headline = {
      title: { en: 'Build it together' },
      subtitle: {},
      accent: { style: 'colour', text: { en: 'together' }, colour: 'support' },
    }
    const kept = readHeadlineMarkup('Build it [together]{accent}')
    if (kept.ok) setHeadline(draft, 'home', 'en', kept.words)
    expect(draft.pages.home.headline?.accent?.colour).toBe('support')
    const cleared = readHeadlineMarkup('Build it [together]{accent:accent}')
    if (cleared.ok) setHeadline(draft, 'home', 'en', cleared.words)
    expect(draft.pages.home.headline?.accent?.colour).toBeUndefined()
  })
})
