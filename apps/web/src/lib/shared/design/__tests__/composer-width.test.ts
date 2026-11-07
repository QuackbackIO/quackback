/**
 * The width of Home's composer in the hero: a few steps, each a measure that
 * keeps to the hero's words, left out to draw as it always has, snapped to
 * while dragging and stepped through with the keyboard.
 */
import { describe, expect, it } from 'vitest'
import {
  composerWidthClass,
  composerWidthKey,
  composerWidthMeasures,
  composerWidthOf,
  drawnComposerWidth,
  snapComposerWidth,
  stepComposerWidth,
  writeComposerWidth,
} from '../composer-width'
import { changeGroup, changeLabel } from '../labels'
import { DESIGN_OPTIONS } from '../options'
import { defaultDesign, portalDesign } from '../schema'

const ALL = DESIGN_OPTIONS.composerWidth

describe('the composer width field', () => {
  it('is a few steps, narrowest first', () => {
    expect(ALL).toEqual(['narrow', 'medium', 'wide', 'full'])
  })

  it('is optional on Home, and only takes its steps', () => {
    const design = defaultDesign()
    expect(portalDesign.parse(design).pages.home.composerWidth).toBeUndefined()
    design.pages.home.composerWidth = 'narrow'
    expect(portalDesign.parse(design).pages.home.composerWidth).toBe('narrow')
    const wrong = structuredClone(design) as unknown as {
      pages: { home: { composerWidth: string } }
    }
    wrong.pages.home.composerWidth = 'huge'
    expect(portalDesign.safeParse(wrong).success).toBe(false)
  })
})

describe('composerWidthClass', () => {
  it('left out, keeps the measure it always had: beside an image or centred, else the words’ width', () => {
    expect(composerWidthClass(undefined, true)).toBe('max-w-[40rem]')
    expect(composerWidthClass(undefined, false)).toBe(
      '[[data-qb-band-align=centre]_&]:max-w-[40rem]'
    )
  })

  it('sets each step from a phone’s width up, and phones keep the full width', () => {
    expect(composerWidthClass('narrow', false)).toBe('max-w-none sm:max-w-[24rem]')
    expect(composerWidthClass('medium', true)).toBe('max-w-none sm:max-w-[32rem]')
    expect(composerWidthClass('wide', false)).toBe('max-w-none sm:max-w-[40rem]')
    expect(composerWidthClass('full', true)).toBe('max-w-none')
  })
})

describe('drawnComposerWidth', () => {
  it('reads a stored step as it is', () => {
    expect(drawnComposerWidth('medium', { side: false, centred: false })).toBe('medium')
  })

  it('reads one left out as the step it draws as', () => {
    expect(drawnComposerWidth(undefined, { side: true, centred: false })).toBe('wide')
    expect(drawnComposerWidth(undefined, { side: false, centred: true })).toBe('wide')
    expect(drawnComposerWidth(undefined, { side: false, centred: false })).toBe('full')
  })
})

describe('composerWidthOf and writeComposerWidth', () => {
  it('reads the hero’s alignment and side image', () => {
    const design = defaultDesign()
    design.layout.bandAlign = 'left'
    expect(composerWidthOf(design)).toBe('full')
    design.layout.bandAlign = 'centre'
    expect(composerWidthOf(design)).toBe('wide')
    design.layout.bandAlign = 'left'
    design.brand.bandImage = { key: 'band/photo.jpg' }
    expect(composerWidthOf(design)).toBe('wide')
    design.layout.imagePlace = 'cover'
    expect(composerWidthOf(design)).toBe('full')
  })

  it('stores a step, and leaves it out where it draws as one left out would', () => {
    const design = defaultDesign()
    design.layout.bandAlign = 'left'
    writeComposerWidth(design, 'narrow')
    expect(design.pages.home.composerWidth).toBe('narrow')
    writeComposerWidth(design, 'full')
    expect(design.pages.home.composerWidth).toBeUndefined()
    design.layout.bandAlign = 'centre'
    writeComposerWidth(design, 'full')
    expect(design.pages.home.composerWidth).toBe('full')
    writeComposerWidth(design, 'wide')
    expect(design.pages.home.composerWidth).toBeUndefined()
  })
})

describe('composerWidthMeasures', () => {
  it('measures each step in px, none past the words’ width', () => {
    expect(composerWidthMeasures(1000, 16)).toEqual([
      { step: 'narrow', px: 384 },
      { step: 'medium', px: 512 },
      { step: 'wide', px: 640 },
      { step: 'full', px: 1000 },
    ])
    expect(composerWidthMeasures(560, 16).map((m) => m.px)).toEqual([384, 512, 560, 560])
  })
})

describe('snapComposerWidth', () => {
  const measures = composerWidthMeasures(1000, 16)

  it('snaps a dragged width to the nearest step', () => {
    expect(snapComposerWidth(100, measures, 'full')).toBe('narrow')
    expect(snapComposerWidth(440, measures, 'full')).toBe('narrow')
    expect(snapComposerWidth(460, measures, 'full')).toBe('medium')
    expect(snapComposerWidth(700, measures, 'full')).toBe('wide')
    expect(snapComposerWidth(900, measures, 'narrow')).toBe('full')
    expect(snapComposerWidth(5000, measures, 'narrow')).toBe('full')
  })

  it('keeps the step it is at among steps that draw alike', () => {
    const tight = composerWidthMeasures(560, 16)
    expect(snapComposerWidth(560, tight, 'wide')).toBe('wide')
    expect(snapComposerWidth(560, tight, 'full')).toBe('full')
    expect(snapComposerWidth(560, tight, 'narrow')).toBe('wide')
  })
})

describe('stepComposerWidth', () => {
  const measures = composerWidthMeasures(1000, 16)

  it('steps one wider or narrower', () => {
    expect(stepComposerWidth('medium', 'wider', measures)).toBe('wide')
    expect(stepComposerWidth('medium', 'narrower', measures)).toBe('narrow')
  })

  it('goes no further than the ends', () => {
    expect(stepComposerWidth('full', 'wider', measures)).toBeNull()
    expect(stepComposerWidth('narrow', 'narrower', measures)).toBeNull()
  })

  it('skips a step that draws as the one it is at', () => {
    const tight = composerWidthMeasures(560, 16)
    expect(stepComposerWidth('medium', 'wider', tight)).toBe('wide')
    expect(stepComposerWidth('wide', 'wider', tight)).toBeNull()
    expect(stepComposerWidth('full', 'narrower', tight)).toBe('medium')
  })
})

describe('composerWidthKey', () => {
  it('reads Shift with Left or Right only', () => {
    expect(composerWidthKey({ key: 'ArrowRight', shiftKey: true })).toBe('wider')
    expect(composerWidthKey({ key: 'ArrowLeft', shiftKey: true })).toBe('narrower')
    expect(composerWidthKey({ key: 'ArrowRight' })).toBeNull()
    expect(composerWidthKey({ key: 'ArrowUp', shiftKey: true })).toBeNull()
    expect(composerWidthKey({ key: 'ArrowRight', shiftKey: true, metaKey: true })).toBeNull()
  })
})

describe('the change card', () => {
  it('names the field, with the composer’s place on Home', () => {
    expect(changeLabel('pages.home.composerWidth')).toBe('Home composer width')
    expect(changeGroup('pages.home.composerWidth')).toBe(changeGroup('pages.home.composer'))
  })
})
