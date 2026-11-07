/**
 * Text metrics on block letters with known capital height, x-height, stem
 * and spacing: size from the capital height over the face's ratio, weight
 * from the stem, line height between baselines, capitals told apart from
 * mixed case, and sizes brought to CSS px at any image scale.
 */
import { describe, expect, it } from 'vitest'
import { measureText, weightFromStem } from '../text-metrics'
import { canvas, letters, rect, type Fill } from './shapes'

const WHITE: Fill = [255, 255, 255]
const INK: Fill = [10, 20, 40]

/** "Hnnn Hnn" at 48px (capital height 33.6), weight from the stem. */
function headline(
  opts: {
    stem?: number
    text?: string
    scale?: number
    lines?: number
    lead?: number
    gap?: number
  } = {}
) {
  const k = opts.scale ?? 1
  const img = canvas(Math.round(700 * k), Math.round(300 * k), WHITE)
  const lines = opts.lines ?? 1
  let right = 0
  for (let i = 0; i < lines; i++) {
    right = Math.max(
      right,
      letters(
        img,
        opts.text ?? 'Hnnn Hnn',
        {
          x: 40 * k,
          baseline: (80 + i * (opts.lead ?? 60)) * k,
          cap: 33.6 * k,
          xHeight: 24 * k,
          stem: (opts.stem ?? 3.9) * k,
          gap: (opts.gap ?? 3) * k,
        },
        INK
      )
    )
  }
  const box = [40 * k, (80 - 33.6) * k, right, (80 + (lines - 1) * (opts.lead ?? 60)) * k]
  return { img, box }
}

describe('measureText', () => {
  it('reads ink and frame, capital height, x-height, stem and baseline', () => {
    const { img, box } = headline()
    const m = measureText(img, box)!
    expect(m.ink.map(Math.round)).toEqual(INK)
    expect(m.frame).toEqual(WHITE)
    expect(m.capHeight).toBeCloseTo(33.6, 0)
    expect(m.xHeight).toBeCloseTo(24, 0)
    expect(m.stroke).toBeCloseTo(3.9, 0)
    expect(m.baseline).toBe(80)
    expect(m.lines).toBe(1)
    expect(m.lineHeight).toBeNull()
  })

  it('gives the size in CSS px from the capital height, 0.73 by default or the face’s own ratio', () => {
    const { img, box } = headline()
    expect(measureText(img, box)!.size).toBeCloseTo(33.6 / 0.73, 0)
    const own = measureText(img, box, { capRatio: 0.66 })!
    expect(own.size).toBeCloseTo(33.6 / 0.66, 0)
    expect(own.capRatio).toBe(0.66)
  })

  it('brings a retina or downscaled image back to CSS px', () => {
    for (const scale of [2, 1024 / 1440]) {
      const { img, box } = headline({ scale })
      const m = measureText(img, box, { scale })!
      expect(Math.abs(m.size - 48) / 48, String(scale)).toBeLessThan(0.08)
      expect(Math.abs(m.weight - 400), String(scale)).toBeLessThan(100)
    }
  })

  it('estimates weight from the stem: light, regular and bold apart', () => {
    const w = (stem: number) => {
      const { img, box } = headline({ stem })
      return measureText(img, box)!.weight
    }
    expect(Math.abs(w(2.7) - 300)).toBeLessThan(60)
    expect(Math.abs(w(3.9) - 400)).toBeLessThan(60)
    expect(Math.abs(w(6.7) - 700)).toBeLessThan(60)
    expect(weightFromStem(0.1148)).toBeCloseTo(400)
    expect(weightFromStem(0.5)).toBe(900)
    expect(weightFromStem(0.01)).toBeGreaterThanOrEqual(100)
  })

  it('measures line height between baselines over lines', () => {
    const { img, box } = headline({ lines: 3, lead: 55 })
    const m = measureText(img, box)!
    expect(m.lines).toBe(3)
    expect(m.lineHeight).toBeCloseTo(55, 0)
    expect(m.leading! * m.size).toBeCloseTo(55, 0)
  })

  it('measures the headline’s own line pitch, not the step to smaller text in its box', () => {
    // Gate 11-02f: Mailwire's two-line headline (pitch 1.02 of its size) drawn far looser,
    // its box taking in text of another size. Here a subtitle sits just under it.
    const { img, box } = headline({ lines: 2, lead: 50 })
    const small = (baseline: number) =>
      letters(img, 'Hnn Hnnn Hn', { x: 40, baseline, cap: 10, xHeight: 7, stem: 1.4, gap: 2 }, INK)
    small(147)
    small(162)
    const m = measureText(img, [box[0]!, box[1]!, box[2]!, 165])!
    expect(m.lineHeight).toBeCloseTo(50, 0)
    expect(m.leading! * m.size).toBeCloseTo(50, 0)
  })

  it('never reads a looser pitch where a subtitle line runs into the last headline line', () => {
    // The box cut into Mailwire's subtitle: its first line joined "developers", whose
    // baseline then read as the subtitle's, 1.48 of the size for a headline set at 0.96.
    const { img, box } = headline({ lines: 2, lead: 50 })
    const sub = 'Hnnnnn Hnnnnnnn Hnnnnnnn Hnnnnnn Hnnnnnnnn Hnnnnn'
    letters(img, sub, { x: 40, baseline: 145, cap: 10, xHeight: 7, stem: 2, gap: 2 }, INK)
    const m = measureText(img, [box[0]!, box[1]!, 500, 147])!
    expect(m.lineHeight ?? 50).toBeCloseTo(50, 0)
  })

  it('gives no line height for one headline line over smaller text', () => {
    const { img, box } = headline()
    const small = (baseline: number) =>
      letters(img, 'Hnn Hnnn Hn', { x: 40, baseline, cap: 10, xHeight: 7, stem: 1.4, gap: 2 }, INK)
    small(97)
    small(112)
    const m = measureText(img, [box[0]!, box[1]!, box[2]!, 115])!
    expect(m.lineHeight).toBeNull()
    expect(m.leading).toBeNull()
  })

  it('tells capitals from mixed case, and lower case with no tall letters from capitals', () => {
    const mixed = headline({ text: 'Hnnn Hnn' })
    expect(measureText(mixed.img, mixed.box)!.upper).toBe(false)
    const caps = headline({ text: 'HHH HHHH' })
    expect(measureText(caps.img, caps.box)!.upper).toBe(true)
    // "nnn": all x-height; the words say there are no tall letters, so it is not capitals,
    // and the size comes from the x-height.
    const img = canvas(400, 200, WHITE)
    const right = letters(
      img,
      'nnn nn',
      { x: 20, baseline: 100, cap: 33.6, xHeight: 24, stem: 3.9, gap: 3 },
      INK
    )
    const m = measureText(img, [20, 76, right, 100], { text: 'mum ox' })!
    expect(m.upper).toBe(false)
    expect(Math.abs(m.size - 24 / 0.52)).toBeLessThan(3)
  })

  it('estimates letter-spacing from the gaps between letters, when the words are known', () => {
    const at = (gap: number) => {
      const { img, box } = headline({ gap, text: 'Hnnn Hnn' })
      return measureText(img, box, { text: 'Hnnn Hnn' })!.letterSpacing!
    }
    // 3.4px of gap at 48px is the untracked 0.07em; each extra 0.96px is 0.02em.
    expect(Math.abs(at(3.36))).toBeLessThan(0.01)
    expect(at(1.4)).toBeLessThan(-0.03)
    expect(at(6)).toBeGreaterThan(0.04)
    expect(measureText(headline().img, headline().box)!.letterSpacing).toBeNull()
  })

  it('reads light text on a dark fill', () => {
    const img = canvas(400, 120, [20, 30, 60])
    const right = letters(
      img,
      'Hnn',
      { x: 30, baseline: 70, cap: 21, xHeight: 15, stem: 3, gap: 2 },
      [250, 250, 250]
    )
    const m = measureText(img, [30, 49, right, 70])!
    expect(m.ink.map(Math.round)).toEqual([250, 250, 250])
    expect(Math.abs(m.size - 30)).toBeLessThan(2)
  })

  it('gives nothing for an empty box or one without contrast', () => {
    const img = canvas(100, 100, WHITE)
    expect(measureText(img, [10, 10, 60, 40])).toBeNull()
    expect(measureText(img, null)).toBeNull()
    rect(img, [0, 0, 100, 100], [250, 250, 250])
    expect(measureText(img, [10, 10, 60, 40])).toBeNull()
  })
})
