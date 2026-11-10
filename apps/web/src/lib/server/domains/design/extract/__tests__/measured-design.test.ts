/**
 * The decision table from measurements to design fields: each field set
 * only from its evidence, with the exact values a tune carries, and every
 * value one the design accepts.
 */
import { describe, expect, it } from 'vitest'
import { DESIGN_OPTIONS } from '@/lib/shared/design/options'
import { tuneSchema } from '@/lib/shared/design/tune'
import type { Corners, EdgeStyle } from '../geometry'
import { designFromMeasures, type Measured } from '../measured-design'
import type { TextMetrics } from '../text-metrics'

const headline = (over: Partial<TextMetrics> = {}): TextMetrics => ({
  ink: [6, 27, 49],
  frame: [255, 255, 255],
  inkBox: [208, 255, 1129, 482],
  lines: 2,
  baseline: 300,
  capHeight: 35,
  xHeight: 25,
  stroke: 3,
  lineHeight: 55,
  leading: 1.15,
  letterSpacing: null,
  size: 48,
  weight: 310,
  stemPerTall: 0.085,
  upper: false,
  capRatio: 0.73,
  ...over,
})

const corners = (radius: number, over: Partial<Corners> = {}): Corners => ({
  radius,
  pill: false,
  corners: [radius, radius, radius, radius],
  width: 140,
  height: 40,
  edge: [83, 58, 253],
  outside: [255, 255, 255],
  ...over,
})

const edge = (over: Partial<EdgeStyle> = {}): EdgeStyle => ({
  kind: 'none',
  inside: [255, 255, 255],
  outside: [255, 255, 255],
  filled: false,
  border: null,
  shadow: null,
  ...over,
})

const card = (radius: number, e: Partial<EdgeStyle>, padding: number | null = 24) => ({
  corners: corners(radius, { width: 320, height: 200 }),
  edge: edge(e),
  padding,
})

describe('designFromMeasures', () => {
  it('reads a light 48px headline as display type at weight 300, with its exact tune', () => {
    const d = designFromMeasures({ headline: headline() })
    expect(d.fields).toMatchObject({
      typeScale: 'display',
      headingWeight: 300,
      textCase: 'sentence',
    })
    expect(d.tune.headline).toEqual({ size: 48, weight: 300, leading: 1.15 })
    expect(d.why.headingWeight).toMatch(/310/)
  })

  it('steps type scale by headline size, and reads capitals as upper case', () => {
    expect(designFromMeasures({ headline: headline({ size: 24 }) }).fields.typeScale).toBe('large')
    expect(designFromMeasures({ headline: headline({ size: 18 }) }).fields.typeScale).toBe(
      'standard'
    )
    expect(designFromMeasures({ headline: headline({ upper: true }) }).fields.textCase).toBe(
      'upper'
    )
    expect(designFromMeasures({ headline: headline({ weight: 760 }) }).fields.headingWeight).toBe(
      800
    )
  })

  it('sets the tracking step only from a clear reading, and carries a matched face’s fit in the tune', () => {
    const fitted = (letterSpacing: number) =>
      designFromMeasures({ headline: headline({ letterSpacing, trackingFitted: true }) })
    expect(fitted(-0.035).fields.tracking).toBe('tight')
    expect(fitted(-0.035).tune.headline?.tracking).toBe(-0.035)
    expect(fitted(0.01).fields.tracking).toBe('normal')
    expect(fitted(0.01).tune.headline?.tracking).toBe(0.01)
    // Between the steps: no step, but the face's own fit (Coralbank: Inter -0.009, site 0).
    const between = fitted(-0.01)
    expect(between.fields.tracking).toBeUndefined()
    expect(between.tune.headline?.tracking).toBe(-0.01)
    expect(between.why.tracking).toMatch(/matched face/)
  })

  it('keeps the tracking a matched face is given within -0.06 to +0.02 em', () => {
    const fitted = (letterSpacing: number) =>
      designFromMeasures({ headline: headline({ letterSpacing, trackingFitted: true }) }).tune
        .headline?.tracking
    expect(fitted(-0.1)).toBe(-0.06)
    expect(fitted(0.18)).toBe(0.02)
  })

  it('believes the gaps between letters only when they read clearly tight', () => {
    // Read from the gaps without a face (no match), the estimate scatters: X0's Postbird
    // read +0.087 where the site is -0.019, Taskflow and Hemla 0 where they are -0.02.
    const gaps = (letterSpacing: number) =>
      designFromMeasures({ headline: headline({ letterSpacing }) })
    expect(gaps(-0.045).fields.tracking).toBe('tight')
    expect(gaps(-0.045).tune.headline?.tracking).toBe(-0.04)
    for (const v of [0, 0.01, 0.087]) {
      expect(gaps(v).fields.tracking).toBeUndefined()
      expect(gaps(v).tune.headline?.tracking).toBeUndefined()
    }
  })

  it('shapes buttons by their corners: square, rounded, pill', () => {
    expect(designFromMeasures({ button: corners(0) }).fields.buttons).toBe('square')
    expect(designFromMeasures({ button: corners(4) }).fields).toMatchObject({
      buttons: 'rounded',
      corners: 'subtle',
    })
    const pill = designFromMeasures({ button: corners(20, { pill: true }) })
    expect(pill.fields).toMatchObject({ buttons: 'pill', corners: 'pill' })
    expect(pill.tune.button).toEqual({ radius: 999, height: 40 })
  })

  it('without a card, rounds the cards a step past a rounded button, not sharper than it', () => {
    expect(designFromMeasures({ button: corners(8) }).tune.card).toEqual({ radius: 12 })
    expect(designFromMeasures({ button: corners(4) }).tune.card).toEqual({ radius: 8 })
    expect(designFromMeasures({ button: corners(30) }).tune.card).toEqual({ radius: 24 })
    // A square or fully round button says nothing about a card's corners.
    expect(designFromMeasures({ button: corners(0) }).tune.card).toBeUndefined()
    expect(designFromMeasures({ button: corners(20, { pill: true }) }).tune.card).toBeUndefined()
    // A card seen keeps its own corners.
    const seen = designFromMeasures({ button: corners(8), card: card(6, { kind: 'border' }) })
    expect(seen.tune.card?.radius).toBe(6)
  })

  it('takes corners from a card when one is seen, apart from the buttons', () => {
    const d = designFromMeasures({
      button: corners(20, { pill: true }),
      card: card(4, { kind: 'border', border: { colour: [220, 220, 220], width: 1 } }),
    })
    expect(d.fields).toMatchObject({ buttons: 'pill', corners: 'subtle', cards: 'bordered' })
    expect(d.tune.card).toEqual({ radius: 4, border: 1, shadow: 'none' })
    expect(designFromMeasures({ card: card(12, {}) }).fields.corners).toBe('rounded')
    expect(designFromMeasures({ card: card(28, { filled: true }) }).fields.corners).toBe('pill')
  })

  it('reads cards as raised, bordered, filled or a list from their edge', () => {
    const kind = (e: Partial<EdgeStyle>) => designFromMeasures({ card: card(8, e) }).fields.cards
    expect(kind({ kind: 'shadow', shadow: { depth: 6 } })).toBe('raised')
    expect(kind({ kind: 'border', border: { colour: [220, 220, 220], width: 1 } })).toBe('bordered')
    expect(kind({ filled: true })).toBe('filled')
    expect(kind({})).toBe('list')
  })

  it('ignores a "card" that does not measure as one (too round or too small)', () => {
    const d = designFromMeasures({ card: { ...card(44, {}) } })
    expect(d.fields.cards).toBeUndefined()
    expect(d.fields.corners).toBeUndefined()
  })

  it('reads density from card padding, else from the gap under the headline', () => {
    expect(designFromMeasures({ card: card(8, {}, 10) }).fields.density).toBe('compact')
    expect(designFromMeasures({ card: card(8, {}, 24) }).fields.density).toBe('comfortable')
    expect(designFromMeasures({ card: card(8, {}, 40) }).fields.density).toBe('spacious')
    expect(designFromMeasures({ headline: headline(), gapBelowHeadline: 30 }).fields.density).toBe(
      'comfortable'
    )
    expect(designFromMeasures({ headline: headline(), gapBelowHeadline: 4 }).fields.density).toBe(
      'compact'
    )
    expect(designFromMeasures({ headline: headline(), gapBelowHeadline: 96 }).fields.density).toBe(
      'spacious'
    )
  })

  it('reads width from the content’s share of the page', () => {
    const w = (ratio: number) =>
      designFromMeasures({ content: { width: ratio * 1440, ratio } }).fields.width
    expect(w(0.85)).toBe('default')
    expect(w(0.99)).toBe('wide')
    expect(w(0.6)).toBe('narrow')
  })

  it('passes the header’s layout through, and maps the current menu item to a menu style', () => {
    const m: Measured = { header: { header: 'inline', menuAlign: 'centre' } }
    expect(designFromMeasures(m).fields).toMatchObject({ header: 'inline', menuAlign: 'centre' })
    const nav = (style: 'pill' | 'tabs' | 'underline' | 'bold' | 'plain' | 'none') =>
      designFromMeasures({ nav: { style, index: style === 'none' ? -1 : 1, items: [] } }).fields.nav
    expect(nav('pill')).toBe('pills')
    expect(nav('tabs')).toBe('tabs')
    expect(nav('underline')).toBe('underline')
    expect(nav('bold')).toBe('plain')
    expect(nav('plain')).toBe('plain')
    expect(nav('none')).toBeUndefined()
  })

  it('draws the menu in the text colour where the site’s is, else the softer grey', () => {
    const text = (strong: boolean) =>
      designFromMeasures({
        navText: { ink: [0, 0, 0], on: [255, 255, 255], share: strong ? 0.9 : 0.6, strong },
      })
    expect(text(true).fields.navText).toBe('ink')
    expect(text(false).fields.navText).toBe('muted')
    expect(text(true).why.navText).toMatch(/menu/)
    expect(designFromMeasures({}).fields.navText).toBeUndefined()
  })

  it('sets the card’s shadow by how far it reaches: soft, lifted or floating', () => {
    const shadow = (depth: number) =>
      designFromMeasures({ card: card(12, { kind: 'shadow', shadow: { depth } }) }).tune.card
        ?.shadow
    expect(shadow(2)).toBe('soft')
    expect(shadow(6)).toBe('lifted')
    expect(shadow(18)).toBe('floating')
    expect(shadow(45)).toBe('deep')
    expect(designFromMeasures({ card: card(12, { kind: 'border' }) }).tune.card?.shadow).toBe(
      'none'
    )
  })

  it('sets nothing without evidence, and only values the design accepts', () => {
    expect(designFromMeasures({})).toEqual({ fields: {}, tune: {}, why: {} })
    const d = designFromMeasures({
      headline: headline({ letterSpacing: -0.05 }),
      button: corners(6),
      card: card(16, { kind: 'shadow', shadow: { depth: 8 } }),
      nav: { style: 'pill', index: 0, items: [] },
      header: { header: 'stacked', menuAlign: 'start' },
      gapBelowHeadline: 24,
      content: { width: 1200, ratio: 0.83 },
      sectionHeading: headline({ size: 32 }),
    })
    for (const [field, value] of Object.entries(d.fields))
      expect(
        DESIGN_OPTIONS[field as keyof typeof DESIGN_OPTIONS] as readonly unknown[],
        field
      ).toContain(value)
    expect(tuneSchema.safeParse(d.tune).success).toBe(true)
    // Every field says why; so does the section heading's size, which only a tune carries.
    expect(Object.keys(d.why).sort()).toEqual([...Object.keys(d.fields), 'heading'].sort())
  })
})

describe('designFromMeasures: a headline known only by its box', () => {
  it('takes the scale step from the size its box holds its words at, and nothing else', () => {
    // The reading was not of the words (withTypeMatch): no exact size, weight, case or spacing.
    const d = designFromMeasures({ headline: null, headlineBlock: 58 })
    expect(d.fields).toEqual({ typeScale: 'display' })
    expect(d.tune.headline).toBeUndefined()
    expect(d.why.typeScale).toMatch(/58px/)
    expect(designFromMeasures({ headlineBlock: 30 }).fields.typeScale).toBe('large')
  })

  it('sizes section headings from it where none showed', () => {
    expect(designFromMeasures({ headlineBlock: 50 }).tune.heading?.size).toBe(24)
  })

  it('gives way to a headline that was read', () => {
    const d = designFromMeasures({ headline: headline({ size: 30 }), headlineBlock: 90 })
    expect(d.fields.typeScale).toBe('large')
    expect(d.tune.headline?.size).toBe(30)
  })
})

describe('designFromMeasures: section headings', () => {
  const size = (m: Measured) => designFromMeasures(m).tune.heading?.size

  it('sizes them from the site’s own, halfway from the house 18px and capped at 28 (Paylane 32px gives 25; the approved design chose 21)', () => {
    expect(size({ headline: headline(), sectionHeading: headline({ size: 32, lines: 1 }) })).toBe(
      25
    )
    // Chatterly’s 50px marketing heading titles a card at the cap (the approved designs chose 24).
    expect(size({ headline: headline({ size: 58 }), sectionHeading: headline({ size: 50 }) })).toBe(
      28
    )
  })

  it('reads them from the headline where none showed (Coralbank 49px gives 24; approved 22; Notewell 96px 28, approved 24)', () => {
    expect(size({ headline: headline({ size: 49 }) })).toBe(24)
    expect(size({ headline: headline({ size: 96 }) })).toBe(28)
    expect(designFromMeasures({ headline: headline({ size: 49 }) }).why.heading).toMatch(/headline/)
  })

  it('stays within 4px of every approved goal design’s heading', () => {
    // Approved: Paylane 21, Coralbank 22, Chatterly, Notewell and Fernway 24; headlines and the site's
    // own headings as X0 measures them.
    const cases: Array<[Measured, number]> = [
      [{ headline: headline({ size: 47 }), sectionHeading: headline({ size: 32 }) }, 21],
      [{ headline: headline({ size: 47 }) }, 21],
      [{ headline: headline({ size: 49 }) }, 22],
      [{ headline: headline({ size: 58 }), sectionHeading: headline({ size: 50 }) }, 24],
      [{ headline: headline({ size: 96 }) }, 24],
      [{ headline: headline({ size: 101 }), sectionHeading: headline({ size: 58 }) }, 24],
    ]
    for (const [m, approved] of cases) expect(Math.abs(size(m)! - approved)).toBeLessThanOrEqual(4)
  })

  it('keeps the house size under a small headline (Hemla 24px)', () => {
    expect(size({ headline: headline({ size: 24 }) })).toBeUndefined()
  })

  it('ignores a heading read as large as the headline: the finder took something else', () => {
    expect(size({ headline: headline({ size: 49 }), sectionHeading: headline({ size: 60 }) })).toBe(
      24
    )
  })
})
