/**
 * An element's brand layer: the exact values a design holds for it (tune).
 * An element's own exact value is what every one of its kind has, so the
 * panel writes there at its widest scope and Reset clears it back to the
 * theme. Values another element shares (the menu's and buttons' label) and
 * the brand's choices are what a row has from the brand.
 */
import { describe, expect, it } from 'vitest'
import { brandValue } from '@/lib/shared/design/override-cascade'
import { defaultDesign } from '@/lib/shared/design/schema'
import { brandOf, everywhereValue, writeEverywhere } from '../element-brand'

describe('an element’s brand layer', () => {
  it('reads a shared exact value and the brand’s choices as what the row has from the brand', () => {
    const design = defaultDesign()
    // The card group reaches post cards and panels both, so it is neither one's own.
    design.tune = { card: { border: 2, shadow: 'deep' } }
    expect(brandOf(design, 'postCard', 'borderWidth')).toBe(2)
    expect(brandOf(design, 'panel', 'shadow')).toBe('deep')
    expect(everywhereValue(design, 'postCard', 'borderWidth')).toBeUndefined()
    design.tune = { label: { weight: 500 } }
    expect(brandOf(design, 'button', 'weight')).toBe(500)
    expect(brandOf(design, 'navItem', 'weight')).toBe(500)
    design.brand.fonts.headlineColour = 'accent'
    design.brand.fonts.labelCase = 'upper'
    design.shape.buttons = 'pill'
    expect(brandOf(design, 'headline', 'color')).toBe('accent')
    expect(brandOf(design, 'button', 'case')).toBe('upper')
    expect(brandOf(design, 'navItem', 'case')).toBe('upper')
    expect(brandOf(design, 'button', 'radius')).toBe(999)
  })

  it('reads an element’s own exact value as every one’s, not as the brand’s', () => {
    const design = defaultDesign()
    const theme = brandValue(design, 'headline', 'size')
    design.tune = { headline: { size: 48 }, button: { radius: 14, case: 'upper' } }
    expect(everywhereValue(design, 'headline', 'size')).toBe(48)
    expect(brandOf(design, 'headline', 'size')).toBe(theme)
    expect(everywhereValue(design, 'button', 'radius')).toBe(14)
    // Capitals in the style's own words.
    expect(everywhereValue(design, 'button', 'case')).toBe('upper')
    // A style value set for every one comes first.
    design.style = { headline: { base: { size: 60 } } }
    expect(everywhereValue(design, 'headline', 'size')).toBe(60)
  })

  it('writes every one’s value to its exact value, clearing the style, and clears both on reset', () => {
    const design = defaultDesign()
    design.tune = { headline: { size: 48, weight: 300 } }
    design.style = { headline: { base: { size: 60 } } }
    writeEverywhere(design, 'headline', 'size', 72)
    expect(design.tune).toEqual({ headline: { size: 72, weight: 300 } })
    expect(design.style).toBeUndefined()
    writeEverywhere(design, 'headline', 'size', undefined)
    expect(design.tune).toEqual({ headline: { weight: 300 } })
    writeEverywhere(design, 'button', 'case', 'none')
    expect(design.tune?.button).toEqual({ case: 'sentence' })
  })

  it('keeps a value its exact value cannot hold in the style, clearing the exact value', () => {
    const design = defaultDesign()
    design.tune = { button: { case: 'upper', fill: 'support' } }
    // Lower case has no exact value.
    writeEverywhere(design, 'button', 'case', 'lower')
    // Colours stay in the style, which follows dark mode; the exact fill is light mode's only.
    writeEverywhere(design, 'button', 'background', 'ink')
    expect(design.tune).toBeUndefined()
    expect(design.style).toEqual({
      button: { base: { case: 'lower', background: 'ink' } },
    })
  })

  it('never writes a value another element shares', () => {
    const design = defaultDesign()
    writeEverywhere(design, 'button', 'size', 15)
    writeEverywhere(design, 'postCard', 'radius', 12)
    expect(design.tune).toBeUndefined()
    expect(design.style).toEqual({
      button: { base: { size: 15 } },
      postCard: { base: { radius: 12 } },
    })
  })
})
