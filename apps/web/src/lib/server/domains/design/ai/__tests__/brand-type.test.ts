/**
 * The brand match's type: faces chosen under the category the finder read
 * and the weights the portal loads, and section headings sized from the
 * site's own for a portal's cards.
 */
import { describe, expect, it } from 'vitest'
import { designFromMeasures } from '../../extract/measured-design'
import type { TextMetrics } from '../../extract/text-metrics'
import { faceById } from '../../extract/fonts/faces'
import type { FaceOption, TypeMatch } from '../../extract/fonts/type-match'
import { accentPhrase, headlineAccentChanges, typeAndShapeChanges } from '../brand-decide'
import { atDrawnWeight, chooseFaces, drawnWeight } from '../brand-fonts'
import { subtitleSize } from '../brand-measure'

const option = (id: string, weight: number, iou: number): FaceOption => ({
  face: faceById(id)!,
  weight,
  size: 48,
  tracking: 0,
  iou,
  capRatio: 0.72,
})

function match(stem: number, ...options: FaceOption[]): TypeMatch {
  const top = options[0]!
  return {
    ...top,
    stem,
    close: top.iou >= 0.7,
    upper: false,
    runnersUp: options.slice(1, 4).map((o) => o.face.id),
    alternatives: options,
    ms: 1,
  }
}

describe('chooseFaces', () => {
  it('takes a face that loads the headline’s 800 (Fernway matched Open Sans, which the portal loads to 700)', () => {
    const chosen = chooseFaces(
      {
        headline: match(
          880,
          option('open-sans', 800, 0.73),
          option('noto-sans', 800, 0.71),
          option('roboto', 800, 0.7)
        ),
        body: null,
      },
      { headline_type: 'sans', body_type: 'sans' }
    )
    expect(chosen.headline!.face.id).toBe('noto-sans')
  })

  it('takes a face that loads 300 where the headline’s stem reads light', () => {
    const chosen = chooseFaces(
      {
        headline: match(
          310,
          option('instrument-sans', 400, 0.66),
          option('roboto', 400, 0.65),
          option('inter', 400, 0.64)
        ),
        body: null,
      },
      { headline_type: 'sans', body_type: 'not_visible' }
    )
    // Roboto's light weight is loaded only for drawing: the face choice weighs the weights it
    // was set against, so loading a weight never changes the face.
    expect(chosen.headline!.face.id).toBe('inter')
  })

  it('chooses the same serif face for a light headline, then draws it at the 300 it loads', () => {
    const chosen = chooseFaces(
      {
        headline: match(300, option('lora', 300, 0.62), option('merriweather', 300, 0.6)),
        body: null,
      },
      { headline_type: 'serif', body_type: 'not_visible' }
    )
    expect(chosen.headline!.face.id).toBe('lora')
    expect(
      drawnWeight({ ...chosen.headline!, face: faceById('merriweather')!, weight: 300, stem: 300 })
    ).toBe(300)
  })

  it('keeps a serif headline serif and a sans body out of monospace', () => {
    const chosen = chooseFaces(
      {
        headline: match(600, option('unbounded', 700, 0.6), option('source-serif', 700, 0.55)),
        body: match(400, option('jetbrains', 400, 0.6), option('dm-sans', 400, 0.58)),
      },
      { headline_type: 'serif', body_type: 'sans' }
    )
    expect(chosen.headline!.face.id).toBe('source-serif')
    expect(chosen.body!.face.id).toBe('dm-sans')
  })

  it('weighs each face’s width at the spacing the portal clamps it to (Fernway: 1.20 times as wide)', () => {
    const fitted = (o: FaceOption, tracking: number) => ({ ...o, tracking })
    const headline = {
      ...match(
        880,
        fitted(option('noto-sans', 800, 0.67), -0.13),
        fitted(option('hanken-grotesk', 800, 0.64), -0.05)
      ),
      widthPx: 640,
      letterGaps: 40,
    }
    const chosen = chooseFaces({ headline, body: null }, { headline_type: 'sans' })
    expect(chosen.headline!.face.id).toBe('hanken-grotesk')
    // Body text is drawn untracked: a face fitted at -0.08em is too wide for it.
    const body = {
      ...match(
        400,
        fitted(option('open-sans', 400, 0.7), -0.08),
        fitted(option('inter', 400, 0.68), 0)
      ),
      widthPx: 600,
      letterGaps: 50,
    }
    expect(chooseFaces({ headline: null, body }, { body_type: 'sans' }).body!.face.id).toBe('inter')
  })

  it('says why in the change it gives', () => {
    const type = chooseFaces(
      {
        headline: match(600, option('unbounded', 700, 0.6), option('source-serif', 700, 0.55)),
        body: null,
      },
      { headline_type: 'serif', body_type: 'not_visible' }
    )
    const fonts = typeAndShapeChanges(designFromMeasures({}), type).find(
      (c) => c.path === 'brand.fonts.heading'
    )!
    expect(fonts.value).toEqual({ kind: 'bundled', id: 'source-serif' })
    expect(fonts.why).toMatch(/serif/)
  })
})

describe('the pairing, where one text was not read', () => {
  const sansHeadline = () => match(500, option('figtree', 500, 0.74), option('dm-sans', 500, 0.7))

  it('sets unread body text in the headline’s face where the site’s text reads as the same kind (Lumen: one family)', () => {
    const type = chooseFaces(
      { headline: sansHeadline(), body: null },
      { headline_type: 'sans', body_type: 'sans' }
    )
    expect(type.body!.face.id).toBe('figtree')
    expect(type.body).toMatchObject({ why: expect.stringMatching(/one family/) })
    // No size is claimed for text that was not read.
    expect(subtitleSize(type.body)).toBeNull()
    const fonts = typeAndShapeChanges(designFromMeasures({}), type)
    expect(fonts.find((c) => c.path === 'brand.fonts.body')!.value).toEqual({
      kind: 'bundled',
      id: 'figtree',
    })
  })

  it('sets unread body text in a plain face of its own kind where it reads as another', () => {
    const serif = () => match(400, option('source-serif', 400, 0.6), option('lora', 400, 0.58))
    const mono = chooseFaces(
      { headline: serif(), body: null },
      { headline_type: 'serif', body_type: 'mono' }
    )
    expect(mono.body!.face.id).toBe('jetbrains')
    const sans = chooseFaces(
      { headline: serif(), body: null },
      { headline_type: 'serif', body_type: 'sans' }
    )
    expect(sans.body!.face.id).toBe('inter')
  })

  it('never sets body text in a mono headline face unless the text reads as mono', () => {
    const mono = () => match(500, option('jetbrains', 500, 0.74), option('fira-code', 500, 0.7))
    for (const body_type of ['not_visible', undefined] as const) {
      const type = chooseFaces({ headline: mono(), body: null }, { headline_type: 'mono', body_type })
      expect(type.headline!.face.id).toBe('jetbrains')
      expect(type.body!.face.id).toBe('inter')
    }
    // Paragraph text read as mono is mono: the headline's face, as one family.
    const code = chooseFaces(
      { headline: mono(), body: null },
      { headline_type: 'mono', body_type: 'mono' }
    )
    expect(code.body!.face.id).toBe('jetbrains')
  })

  it('never sets body text in a condensed or wide headline face', () => {
    const condensed = match(600, option('oswald', 600, 0.72), option('roboto', 600, 0.5))
    const type = chooseFaces(
      { headline: { ...condensed, glyphWidth: -0.3, letters: 20 }, body: null },
      { headline_type: 'sans', body_type: 'not_visible' }
    )
    expect(type.headline!.face.id).toBe('oswald')
    expect(type.body!.face.id).toBe('inter')
  })

  it('takes a body crop no face draws for unread (Kestrel: its ink was a photo)', () => {
    const type = chooseFaces(
      {
        headline: sansHeadline(),
        body: match(450, option('jetbrains', 500, 0.26), option('work-sans', 500, 0.26)),
      },
      { headline_type: 'sans', body_type: 'sans' }
    )
    expect(type.body!.face.id).toBe('figtree')
  })

  it('sets an unread headline in the face of clearly read text of its kind', () => {
    const type = chooseFaces(
      {
        headline: match(500, option('geist', 500, 0.38), option('libre-franklin', 500, 0.33)),
        body: match(440, option('libre-franklin', 500, 0.69), option('archivo', 500, 0.65)),
      },
      { headline_type: 'sans', body_type: 'sans' }
    )
    expect(type.headline!.face.id).toBe('libre-franklin')
    expect(type.body!.face.id).toBe('libre-franklin')
  })

  it('keeps an unread headline whose clearly read text is of another kind', () => {
    const type = chooseFaces(
      {
        headline: match(800, option('archivo', 800, 0.3), option('work-sans', 800, 0.29)),
        body: match(500, option('merriweather', 500, 0.58), option('lora', 500, 0.54)),
      },
      { headline_type: 'sans', body_type: 'serif' }
    )
    expect(type.headline!.face.id).toBe('archivo')
    expect(type.body!.face.id).toBe('merriweather')
  })

  it('leaves unread body text to the site where it names a face', () => {
    const type = chooseFaces(
      { headline: sansHeadline(), body: null },
      { headline_type: 'sans', body_type: 'sans' },
      { body: { id: 'lato', exact: true, kind: 'sans', why: 'the site sets its text in Lato' } }
    )
    expect(type.body).toBeNull()
  })
})

describe('the headline refitted at the weight it is drawn', () => {
  const fits = (...xs: Array<[number, number, number]>) =>
    xs.map(([weight, size, tracking]) => ({ weight, size, tracking }))
  const chosen = (m: TypeMatch) => ({ ...m, why: '' })

  it('takes the spacing and size of the lighter weight the stem reads (Forgeline: Mona Sans 500 fitted, 400 drawn)', () => {
    const mona = {
      ...option('mona-sans', 500, 0.8),
      size: 56.3,
      tracking: -0.027,
      fits: fits([400, 55.7, -0.009], [500, 56.3, -0.027], [600, 56.6, -0.045]),
    }
    const m = atDrawnWeight(chosen(match(461, mona)))
    expect(m.tracking).toBeCloseTo(-0.009)
    expect(m.size).toBeCloseTo(55.7)
    expect(m.capRatio).toBeCloseTo((0.72 * 56.3) / 55.7)
  })

  it('interpolates between the weights drawn, and keeps the fit without them', () => {
    const face = {
      ...option('inter', 500, 0.8),
      fits: fits([400, 48, 0], [600, 48, -0.04]),
    }
    // Inter loads 500 itself, so a stem of 500 keeps the fitted 500: between the two drawn.
    expect(atDrawnWeight(chosen(match(500, face))).tracking).toBeCloseTo(-0.02)
    const bare = { ...option('inter', 500, 0.8), tracking: -0.03 }
    expect(atDrawnWeight(chosen(match(500, bare))).tracking).toBe(-0.03)
  })

  it('takes Inter where its own fit is a spacing the portal draws, else Inter Tight (Notewell: Inter -0.041em)', () => {
    const tight = {
      ...option('inter-tight', 600, 0.78),
      tracking: -0.004,
      fits: fits([600, 96, -0.004]),
    }
    const inter = { ...option('inter', 600, 0.75), tracking: -0.041, fits: fits([600, 96, -0.041]) }
    expect(atDrawnWeight(chosen(match(640, tight, inter))).face.id).toBe('inter')
    expect(atDrawnWeight(chosen(match(640, tight, inter))).tracking).toBeCloseTo(-0.041)
    const tooTight = { ...inter, tracking: -0.09, fits: fits([600, 96, -0.09]) }
    expect(atDrawnWeight(chosen(match(640, tight, tooTight))).face.id).toBe('inter-tight')
  })
})

describe('the subtitle’s size in a brand match', () => {
  it('is the matched face’s size in whole px, where the drawing fits', () => {
    const m = (size: number, iou: number) => ({ ...match(400, option('inter', 400, iou)), size })
    expect(subtitleSize(m(19.7, 0.7))).toBe(20)
    expect(subtitleSize(m(19.7, 0.4))).toBeNull()
    expect(subtitleSize(m(40, 0.7))).toBeNull()
    expect(subtitleSize(null)).toBeNull()
    const sub = typeAndShapeChanges(designFromMeasures({}), {
      headline: null,
      body: m(15.4, 0.64),
    }).find((c) => c.path === 'tune.subtitle.size')
    expect(sub?.value).toBe(15)
  })
})

describe('headline tracking in a brand match', () => {
  const tracking = (letterSpacing: number | null) =>
    typeAndShapeChanges(
      designFromMeasures({
        headline: {
          size: 58,
          weight: 700,
          letterSpacing,
          trackingFitted: true,
          upper: false,
        } as TextMetrics,
      }),
      null
    ).find((c) => c.path === 'tune.headline.tracking')

  it('carries the fitted tracking', () => {
    expect(tracking(-0.035)?.value).toBe(-0.035)
  })

  it('sets the house spacing where none was measured, so an earlier design’s does not stay', () => {
    // Live check 11-02: Fernway's poor fit left the draft's earlier -0.05em in place.
    expect(tracking(null)?.value).toBe(-0.02)
    expect(tracking(null)?.why).toMatch(/house/)
  })

  it('carries a fit between the tight and normal steps', () => {
    expect(tracking(-0.01)?.value).toBe(-0.01)
  })
})

describe('headline line height in a brand match', () => {
  const leading = (lines: number, value: number | null) =>
    typeAndShapeChanges(
      designFromMeasures({
        headline: {
          size: 90,
          weight: 400,
          letterSpacing: null,
          upper: false,
          lines,
          lineHeight: value === null ? null : value * 90,
          leading: value,
        } as TextMetrics,
      }),
      null
    ).find((c) => c.path === 'tune.headline.leading')

  it('carries the pitch of a headline on several lines', () => {
    expect(leading(2, 1.02)?.value).toBe(1.02)
    expect(leading(3, 1.18)?.value).toBe(1.18)
  })

  it('keeps it within what headlines are set at', () => {
    // X0 dev and goal headlines: 0.87 (Fernway) to 1.25 (Hemla).
    expect(leading(2, 0.8)?.value).toBe(0.85)
    expect(leading(2, 1.45)?.value).toBe(1.35)
  })

  it('takes a far looser pitch for a misreading, and keeps the face’s own', () => {
    // Gate 11-02f: Mailwire's headline (1.02 on the site) drawn at 1.53.
    expect(leading(2, 1.9)).toMatchObject({ value: null })
  })

  it('keeps the face’s own line height for one line, so an earlier design’s does not stay', () => {
    expect(leading(1, null)).toMatchObject({ value: null })
    expect(leading(1, null)?.why).toMatch(/one line/)
  })
})

describe('section headings in a brand match', () => {
  it('sets their size with its evidence', () => {
    const headline = { size: 58, weight: 700, letterSpacing: null, upper: false } as TextMetrics
    const change = typeAndShapeChanges(designFromMeasures({ headline }), null).find(
      (c) => c.path === 'tune.heading.size'
    )
    expect(change?.value).toBe(26)
    expect(change?.why).toMatch(/headline 58px/)
  })
})

describe('a two-tone headline in a brand match', () => {
  const tone = (place: 'head' | 'tail', style: 'colour' | 'muted') => ({
    main: [10, 37, 64] as [number, number, number],
    accent: [66, 84, 102] as [number, number, number],
    place,
    style,
  })
  const titles = [
    {
      path: 'pages.home.headline.title',
      value: 'Ideas that shape Acme. Tell us what to build next',
      why: '',
    },
    { path: 'pages.feedback.headline.title', value: 'Share your ideas', why: '' },
  ]

  it('sets the later sentence apart, lighter, as the site sets its later lines (Paylane)', () => {
    const changes = headlineAccentChanges(tone('tail', 'muted'), titles, 'en')
    expect(changes.find((c) => c.path === 'pages.home.headline.accent')?.value).toEqual({
      style: 'muted',
      text: { en: 'Tell us what to build next' },
    })
    expect(changes.find((c) => c.path === 'pages.feedback.headline.accent')?.value).toEqual({
      style: 'muted',
      text: { en: 'your ideas' },
    })
    expect(changes[0]!.why).toMatch(/lighter/)
  })

  it('sets the first part apart in colour where the site does', () => {
    const changes = headlineAccentChanges(tone('head', 'colour'), titles, 'en')
    expect(changes.find((c) => c.path === 'pages.home.headline.accent')?.value).toEqual({
      style: 'colour',
      text: { en: 'Ideas that shape Acme.' },
    })
  })

  it('gives nothing for a one-tone headline or a title too short to split', () => {
    expect(headlineAccentChanges(null, titles, 'en')).toEqual([])
    expect(
      headlineAccentChanges(
        tone('tail', 'muted'),
        [{ path: 'pages.home.headline.title', value: 'Feedback', why: '' }],
        'en'
      )
    ).toEqual([])
  })

  it('marks the phrase on the words as the editor reads them, spaces and all', () => {
    const changes = headlineAccentChanges(
      tone('tail', 'muted'),
      [{ path: 'pages.home.headline.title', value: 'Ideas  that shape   Acme', why: '' }],
      'en'
    )
    const accent = changes.find((c) => c.path === 'pages.home.headline.accent')?.value as {
      text: { en: string }
    }
    const title = changes.find((c) => c.path === 'pages.home.headline.title')?.value as string
    expect(title).toBe('Ideas that shape Acme')
    expect(title.endsWith(accent.text.en)).toBe(true)
  })

  it('splits at a clause, else at the middle word, and keeps to 60 characters', () => {
    expect(accentPhrase('Ideas, shaped together', 'tail')).toBe('shaped together')
    expect(accentPhrase('Ideas, shaped together', 'head')).toBe('Ideas')
    expect(accentPhrase('Tell us what to build', 'tail')).toBe('what to build')
    const long = `Short start. ${'word '.repeat(20).trim()}`
    expect(accentPhrase(long, 'tail')!.length).toBeLessThanOrEqual(60)
  })
})
