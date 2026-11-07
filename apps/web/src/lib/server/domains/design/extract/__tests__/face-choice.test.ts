/**
 * The face a text is set in, chosen from the matcher's ranking under the
 * site's type category and the weights the portal loads. The gate's misses
 * this guards (11-02d): a monospace body for a geometric sans (Calmly), a
 * wide display sans for a serif headline (the Daily Ledger), and Fernway's 800
 * drawn at 700 because the matched Open Sans loads only up to 700.
 */
import { describe, expect, it } from 'vitest'
import { faceById } from '../fonts/faces'
import { chooseFace } from '../fonts/face-choice'
import type { FaceOption, TypeMatch } from '../fonts/type-match'

const option = (id: string, weight: number, iou: number): FaceOption => ({
  face: faceById(id)!,
  weight,
  size: 40,
  tracking: 0,
  iou,
  capRatio: 0.72,
})

/** A match whose ranking is the options given, best first. */
function match(...options: FaceOption[]): TypeMatch {
  const top = options[0]!
  return {
    ...top,
    stem: top.weight,
    close: top.iou >= 0.7,
    upper: false,
    runnersUp: options.slice(1, 4).map((o) => o.face.id),
    alternatives: options,
    ms: 1,
  }
}

/** The weights the portal loads, as the bundled fonts list them for these faces. */
const LOADS: Record<string, number[]> = {
  'open-sans': [400, 500, 600, 700],
  'instrument-sans': [400, 500, 600, 700],
  'noto-sans': [400, 500, 600, 700, 800],
  'hanken-grotesk': [300, 400, 500, 600, 700, 800],
  roboto: [400, 500, 600, 700],
  inter: [300, 400, 500, 600, 700, 800],
  'dm-sans': [300, 400, 500, 600, 700],
  unbounded: [400, 500, 600, 700, 800, 900],
  'roboto-slab': [400, 500, 600, 700, 800, 900],
  fraunces: [400, 500, 600, 700, 800, 900],
  lora: [400, 500, 600, 700],
  jetbrains: [400, 500, 600, 700],
  'fira-code': [400, 500, 600, 700],
  nunito: [400, 500, 600, 700],
}
const loads = (id: string) => LOADS[id] ?? [400, 500, 600, 700]

describe('chooseFace: the category', () => {
  it('never sets a serif headline in a sans, even a closer one', () => {
    const m = match(
      option('unbounded', 800, 0.6),
      option('archivo', 800, 0.58),
      option('roboto-slab', 700, 0.55),
      option('fraunces', 700, 0.48)
    )
    const chosen = chooseFace(m, { kind: 'serif', role: 'headline', weight: 700, loads })
    expect(chosen.face.top).toBe('serif')
    expect(chosen.face.id).toBe('roboto-slab')
    expect(chosen.why).toMatch(/serif/)
  })

  it('keeps the matcher’s order within the serif category', () => {
    const m = match(option('lora', 700, 0.6), option('fraunces', 700, 0.61))
    expect(chooseFace(m, { kind: 'serif', role: 'headline', weight: 700, loads }).face.id).toBe(
      'lora'
    )
  })

  it('never sets a sans body in monospace when nothing is close', () => {
    const m = match(option('jetbrains', 400, 0.55), option('dm-sans', 400, 0.53))
    expect(chooseFace(m, { kind: 'sans', role: 'body', weight: 400, loads }).face.id).toBe(
      'dm-sans'
    )
    // Unread, a monospace face still needs a close fit.
    expect(chooseFace(m, { kind: null, role: 'body', weight: 400, loads }).face.id).toBe('dm-sans')
  })

  it('keeps monospace where the site’s text is monospace', () => {
    const m = match(option('dm-sans', 400, 0.6), option('jetbrains', 400, 0.58))
    expect(chooseFace(m, { kind: 'mono', role: 'body', weight: 400, loads }).face.id).toBe(
      'jetbrains'
    )
    // Unread, a close monospace fit is evidence enough.
    const close = match(option('jetbrains', 400, 0.82), option('dm-sans', 400, 0.6))
    expect(chooseFace(close, { kind: null, role: 'body', weight: 400, loads }).face.id).toBe(
      'jetbrains'
    )
  })

  it('takes a wide display sans only on a close fit', () => {
    const loose = match(option('unbounded', 800, 0.62), option('archivo', 800, 0.6))
    expect(chooseFace(loose, { kind: 'sans', role: 'headline', weight: 800, loads }).face.id).toBe(
      'archivo'
    )
    const close = match(option('unbounded', 800, 0.8), option('archivo', 800, 0.66))
    expect(chooseFace(close, { kind: 'sans', role: 'headline', weight: 800, loads }).face.id).toBe(
      'unbounded'
    )
  })

  it('falls back across categories in order when the read one has no face ranked', () => {
    // Only sans faces ranked (a matcher run on part of the faces): a serif reading keeps the best sans.
    const m = match(option('inter', 400, 0.6), option('jetbrains', 400, 0.59))
    expect(chooseFace(m, { kind: 'serif', role: 'headline', weight: 400, loads }).face.id).toBe(
      'inter'
    )
  })

  it('keeps the matcher’s answer where nothing is against it', () => {
    const m = match(option('inter', 600, 0.8), option('roboto', 600, 0.7))
    const chosen = chooseFace(m, { kind: 'sans', role: 'headline', weight: 600, loads })
    expect(chosen.face.id).toBe('inter')
    expect(chosen.why).toBe('')
  })
})

describe('chooseFace: condensed faces', () => {
  // Gate 11-02e: Barlow Condensed for normal-width headlines (letters collided at the
  // tracking floor) and Oswald for normal-width body text (cramped), each ranked first.
  const ranked = (glyphWidth: number | undefined) => ({
    ...match(
      option('barlow-condensed', 600, 0.74),
      option('oswald', 600, 0.72),
      option('roboto', 600, 0.7)
    ),
    glyphWidth,
  })

  it.each(['headline', 'body'] as const)(
    'never sets normal-width %s text in a condensed face, however it ranks',
    (role) => {
      for (const kind of ['sans', null] as const) {
        const chosen = chooseFace(ranked(-0.03), { kind, role, weight: 600, loads })
        expect(chosen.face.id).toBe('roboto')
        expect(chosen.why).toMatch(/condensed/)
      }
    }
  )

  it('takes a condensed face where the text measures condensed', () => {
    expect(
      chooseFace(ranked(-0.3), { kind: 'sans', role: 'headline', weight: 600, loads }).face.id
    ).toBe('barlow-condensed')
  })

  it('takes none without a width reading', () => {
    expect(
      chooseFace(ranked(undefined), { kind: 'sans', role: 'body', weight: 600, loads }).face.id
    ).toBe('roboto')
  })

  // Gate 11-02f: Barlow Condensed for Backerly's and Dishdash's headlines (photos behind,
  // overlap 0.00) and Oswald for Tickoff's, Hostwell's and Leadpost's paragraphs. A width
  // read from a drawing that does not fit (words misplaced on lines, a photo in the crop)
  // is noise: on the fixtures, a normal headline told three words too many reads -0.28 with
  // every face at 0.40, while condensed text draws in a condensed face at 0.66 to 0.94,
  // ahead of every normal face.
  it.each(['headline', 'body'] as const)(
    'trusts a condensed reading of %s text only where a condensed face draws it best',
    (role) => {
      const misread = {
        ...match(
          option('barlow-condensed', 600, 0.4),
          option('oswald', 600, 0.4),
          option('roboto', 600, 0.4)
        ),
        glyphWidth: -0.28,
        letters: 60,
      }
      expect(chooseFace(misread, { kind: 'sans', role, weight: 600, loads }).face.id).toBe('roboto')
      const behind = {
        ...match(option('barlow-condensed', 600, 0.05), option('roboto', 600, 0.03)),
        glyphWidth: -0.7,
        letters: 60,
      }
      expect(chooseFace(behind, { kind: 'sans', role, weight: 600, loads }).face.id).toBe('roboto')
    }
  )

  it('needs a paragraph’s worth of letters before it calls body text condensed', () => {
    const few = { ...ranked(-0.3), letters: 9 }
    expect(chooseFace(few, { kind: 'sans', role: 'body', weight: 600, loads }).face.id).toBe(
      'roboto'
    )
    const many = { ...ranked(-0.3), letters: 60 }
    expect(chooseFace(many, { kind: 'sans', role: 'body', weight: 600, loads }).face.id).toBe(
      'barlow-condensed'
    )
  })
})

describe('chooseFace: the width at the letter-spacing the portal draws', () => {
  // A line 600px wide with 40 letter gaps at 40px: a face fitted at -0.13em draws it
  // 1 + 0.09 * 40 * 40 / 600 = 1.24 times as wide at -0.04em (Fernway: Noto Sans 900 at
  // 1.20 on the 11-02f gate).
  const fitted = (id: string, weight: number, iou: number, tracking: number): FaceOption => ({
    ...option(id, weight, iou),
    tracking,
  })
  const wide = (...options: FaceOption[]) => ({
    ...match(...options),
    glyphWidth: -0.12,
    letters: 40,
    widthPx: 600,
    letterGaps: 40,
  })
  /** The portal's clamp: -0.04 to 0.02em. */
  const drawnAt = (o: FaceOption) => Math.min(0.02, Math.max(-0.04, o.tracking))

  it('prefers a near face that keeps the width once its spacing is clamped', () => {
    const m = wide(
      fitted('noto-sans', 800, 0.67, -0.13),
      fitted('hanken-grotesk', 800, 0.64, -0.05),
      fitted('roboto', 700, 0.63, -0.04)
    )
    const chosen = chooseFace(m, { kind: 'sans', role: 'headline', weight: 800, loads, drawnAt })
    expect(chosen.face.id).toBe('hanken-grotesk')
    expect(chosen.why).toMatch(/wide/)
  })

  it('keeps the best drawn face when its width holds, or no near face does better', () => {
    const holds = wide(
      fitted('inter', 800, 0.8, -0.03),
      fitted('roboto', 700, 0.78, 0),
      fitted('hanken-grotesk', 800, 0.77, -0.02)
    )
    expect(
      chooseFace(holds, { kind: 'sans', role: 'headline', weight: 800, loads, drawnAt }).face.id
    ).toBe('inter')
    const far = wide(fitted('noto-sans', 800, 0.8, -0.13), fitted('roboto', 700, 0.6, -0.04))
    expect(
      chooseFace(far, { kind: 'sans', role: 'headline', weight: 800, loads, drawnAt }).face.id
    ).toBe('noto-sans')
  })

  it('stays within the category and never turns to a condensed face for width', () => {
    const m = wide(
      fitted('fraunces', 700, 0.66, -0.12),
      fitted('oswald', 700, 0.65, 0),
      fitted('inter', 700, 0.65, -0.03),
      fitted('lora', 700, 0.64, -0.04)
    )
    const chosen = chooseFace(m, { kind: 'serif', role: 'headline', weight: 700, loads, drawnAt })
    expect(chosen.face.id).toBe('lora')
  })

  it('judges body text at its own spacing (none)', () => {
    const m = wide(fitted('open-sans', 400, 0.7, -0.08), fitted('inter', 400, 0.68, 0))
    expect(
      chooseFace(m, { kind: 'sans', role: 'body', weight: 400, loads, drawnAt: () => 0 }).face.id
    ).toBe('inter')
  })
})

describe('chooseFace: the weight', () => {
  it('takes a near face that loads the measured weight (Fernway: 800 in Open Sans, which loads 700)', () => {
    const m = match(
      option('open-sans', 800, 0.73),
      option('noto-sans', 800, 0.71),
      option('hanken-grotesk', 800, 0.7)
    )
    const chosen = chooseFace(m, { kind: 'sans', role: 'headline', weight: 800, loads })
    expect(chosen.face.id).toBe('noto-sans')
    expect(chosen.why).toMatch(/800/)
  })

  it('takes a face that loads a light 300 for light display type', () => {
    const m = match(
      option('instrument-sans', 400, 0.66),
      option('roboto', 400, 0.64),
      option('inter', 400, 0.63)
    )
    expect(chooseFace(m, { kind: 'sans', role: 'headline', weight: 300, loads }).face.id).toBe(
      'inter'
    )
  })

  it('keeps the face when no near face of its category loads the weight', () => {
    const m = match(
      option('open-sans', 800, 0.73),
      option('lora', 800, 0.7),
      // Too far behind to stand in.
      option('noto-sans', 800, 0.5)
    )
    expect(chooseFace(m, { kind: 'sans', role: 'headline', weight: 800, loads }).face.id).toBe(
      'open-sans'
    )
  })

  it('keeps the face when it loads a weight within a step', () => {
    const m = match(option('open-sans', 700, 0.73), option('noto-sans', 700, 0.72))
    expect(chooseFace(m, { kind: 'sans', role: 'headline', weight: 700, loads }).face.id).toBe(
      'open-sans'
    )
  })
})

describe('chooseFace: the classification', () => {
  it('takes a slab serif only where it fits clearly better than a plain serif (Wayfold: a soft transitional headline)', () => {
    const m = match(
      option('roboto-slab', 400, 0.56),
      option('source-serif', 400, 0.53),
      option('fraunces', 400, 0.51)
    )
    const chosen = chooseFace(m, { kind: 'serif', role: 'headline', weight: 400, loads })
    expect(chosen.face.id).toBe('source-serif')
    expect(chosen.why).toMatch(/slab/)
  })

  it('keeps a slab serif that fits clearly better', () => {
    const m = match(option('roboto-slab', 700, 0.62), option('source-serif', 700, 0.52))
    expect(chooseFace(m, { kind: 'serif', role: 'headline', weight: 700, loads }).face.id).toBe(
      'roboto-slab'
    )
  })

  it('takes a rounded face only where it fits clearly better than a plain one of its category', () => {
    const near = match(option('quicksand', 400, 0.24), option('work-sans', 400, 0.23))
    expect(chooseFace(near, { kind: 'sans', role: 'headline', weight: 400, loads }).face.id).toBe(
      'work-sans'
    )
    const clear = match(option('nunito', 600, 0.64), option('ibm-plex-sans', 600, 0.59))
    expect(chooseFace(clear, { kind: 'sans', role: 'body', weight: 600, loads }).face.id).toBe(
      'nunito'
    )
  })

  it('sets body text in a display serif only on a close fit', () => {
    const loose = match(
      option('fraunces', 400, 0.58),
      option('merriweather', 600, 0.53),
      option('source-serif', 400, 0.52)
    )
    const chosen = chooseFace(loose, { kind: 'serif', role: 'body', weight: 400, loads })
    expect(chosen.face.id).toBe('merriweather')
    expect(chosen.why).toMatch(/display/)
    const close = match(option('playfair', 400, 0.74), option('lora', 400, 0.7))
    expect(chooseFace(close, { kind: 'serif', role: 'body', weight: 400, loads }).face.id).toBe(
      'playfair'
    )
  })

  it('keeps a display serif for a headline', () => {
    const m = match(option('fraunces', 400, 0.64), option('source-serif', 500, 0.6))
    expect(chooseFace(m, { kind: 'serif', role: 'headline', weight: 400, loads }).face.id).toBe(
      'fraunces'
    )
  })
})
