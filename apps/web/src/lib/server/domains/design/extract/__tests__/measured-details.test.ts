/**
 * The finer exact values from a screenshot: the subtitle's colour, the
 * section headings' line height and colour, the labels' size and case, and a
 * text field's corners; each only from its own evidence, and every value one
 * the tune accepts.
 */
import { describe, expect, it } from 'vitest'
import { tuneSchema } from '@/lib/shared/design/tune'
import type { Corners } from '../geometry'
import { detailsFromMeasures } from '../measured-details'
import type { TextMetrics } from '../text-metrics'

const text = (over: Partial<TextMetrics> = {}): TextMetrics => ({
  ink: [17, 17, 17],
  frame: [255, 255, 255],
  inkBox: [100, 100, 600, 130],
  lines: 1,
  baseline: 124,
  capHeight: 12,
  xHeight: 9,
  stroke: 1.5,
  lineHeight: null,
  leading: null,
  letterSpacing: null,
  size: 16,
  weight: 400,
  stemPerTall: 0.1,
  upper: false,
  capRatio: 0.73,
  ...over,
})

const field = (radius: number, over: Partial<Corners> = {}): Corners => ({
  radius,
  pill: false,
  corners: [radius, radius, radius, radius],
  width: 300,
  height: 44,
  edge: [208, 215, 222],
  outside: [255, 255, 255],
  ...over,
})

describe('the subtitle’s colour', () => {
  it('is the ink the subtitle is drawn in (the portal drew every one in a mid grey)', () => {
    const d = detailsFromMeasures({ subtitle: text({ ink: [22.4, 51, 0.2] }) })
    expect(d.tune.subtitle).toEqual({ colour: '#163300' })
    expect(d.why.subtitleColour).toMatch(/#163300/)
  })

  it('is left out without a subtitle', () => {
    expect(detailsFromMeasures({}).tune.subtitle).toBeUndefined()
  })
})

describe('the section headings’ line height', () => {
  it('is their own pitch over their size where one showed in two lines', () => {
    const d = detailsFromMeasures({
      sectionHeading: text({ size: 40, lineHeight: 44, leading: 1.4, lines: 2 }),
      headline: text({ size: 64, leading: 1.2 }),
    })
    expect(d.tune.heading?.leading).toBe(1.1)
    expect(d.why.headingLeading).toMatch(/section headings/)
  })

  it('is the headline’s pitch where no heading showed (most sites set them alike)', () => {
    const d = detailsFromMeasures({ headline: text({ size: 64, leading: 1.15 }) })
    expect(d.tune.heading?.leading).toBe(1.15)
    expect(d.why.headingLeading).toMatch(/headline/)
  })

  it('is kept from 1 to 1.35, and a pitch outside 0.8 to 1.6 is not believed', () => {
    const at = (leading: number) =>
      detailsFromMeasures({ headline: text({ leading }) }).tune.heading?.leading
    expect(at(0.87)).toBe(1)
    expect(at(1.5)).toBe(1.35)
    expect(at(0.7)).toBeUndefined()
    expect(at(1.9)).toBeUndefined()
  })

  it('is left out for a one-line headline and no heading', () => {
    expect(detailsFromMeasures({ headline: text() }).tune.heading?.leading).toBeUndefined()
  })
})

describe('the section headings’ colour', () => {
  it('is a section heading’s own ink on the page', () => {
    const d = detailsFromMeasures({ sectionHeading: text({ ink: [6, 27, 49] }) })
    expect(d.tune.heading?.colour).toBe('#061b31')
    expect(d.why.headingColour).toMatch(/section headings are set in/)
  })

  it('is the headline’s ink as the page shows it where no heading showed', () => {
    const d = detailsFromMeasures({
      headline: text({ ink: [40, 40, 40] }),
      headlineInk: [34, 34, 34],
    })
    expect(d.tune.heading?.colour).toBe('#222222')
  })

  it('is not taken from a headline on a band or in a light ink', () => {
    // White on a coloured hero says nothing of the page's headings (Coralbank, Hemla, Postbird).
    const onBand = text({ ink: [255, 255, 255], frame: [0, 88, 163] })
    expect(detailsFromMeasures({ headline: onBand }).tune.heading).toBeUndefined()
    const darkOnBand = text({ ink: [20, 20, 20], frame: [255, 219, 0] })
    expect(detailsFromMeasures({ headline: darkOnBand }).tune.heading).toBeUndefined()
  })
})

describe('the labels’ size and case', () => {
  it('is the call to action’s label size, rounded, within 12 to 18px', () => {
    expect(detailsFromMeasures({ label: text({ size: 15.4 }) }).tune.label).toEqual({ size: 15 })
    expect(detailsFromMeasures({ label: text({ size: 11 }) }).tune.label).toEqual({ size: 12 })
    expect(detailsFromMeasures({ label: text({ size: 20.6 }) }).tune.label).toEqual({ size: 18 })
  })

  it('believes no label reading outside 10 to 22px', () => {
    expect(detailsFromMeasures({ label: text({ size: 34 }) }).tune.label).toBeUndefined()
    expect(detailsFromMeasures({ label: text({ size: 8 }) }).tune.label).toBeUndefined()
  })

  it('sets capitals where the main button’s words are set in them', () => {
    const d = detailsFromMeasures({ buttonText: text({ upper: true }) })
    expect(d.tune.button).toEqual({ case: 'upper' })
    expect(detailsFromMeasures({ buttonText: text() }).tune.button).toBeUndefined()
  })
})

describe('a text field’s corners', () => {
  it('is the field’s radius, rounded', () => {
    expect(detailsFromMeasures({ field: field(8.4) }).tune.field).toEqual({ radius: 8 })
    expect(detailsFromMeasures({ field: field(0) }).tune.field).toEqual({ radius: 0 })
  })

  it('leaves a fully round field out: a round search bar is a wrapper’s shape', () => {
    expect(detailsFromMeasures({ field: field(22, { pill: true }) }).tune.field).toBeUndefined()
  })

  it('leaves out a box not sized as a field', () => {
    expect(detailsFromMeasures({ field: field(11, { height: 83 }) }).tune.field).toBeUndefined()
    expect(detailsFromMeasures({ field: field(4, { height: 20 }) }).tune.field).toBeUndefined()
    expect(detailsFromMeasures({ field: field(4, { width: 80 }) }).tune.field).toBeUndefined()
  })
})

it('gives only values the tune accepts', () => {
  const d = detailsFromMeasures({
    headline: text({ leading: 1.2 }),
    subtitle: text({ ink: [90, 102, 119] }),
    sectionHeading: text({ ink: [6, 27, 49] }),
    label: text({ size: 14 }),
    buttonText: text({ upper: true }),
    field: field(6),
  })
  expect(Object.keys(d.tune).sort()).toEqual(['button', 'field', 'heading', 'label', 'subtitle'])
  expect(tuneSchema.safeParse(d.tune).success).toBe(true)
})
