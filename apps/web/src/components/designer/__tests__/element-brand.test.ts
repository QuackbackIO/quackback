/**
 * An element's brand layer: the exact values a design holds for it (tune),
 * read as the value a row has from the brand, and its brand choices, read
 * where no exact value sets the property.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { brandOf, clearExactValues, exactValuesOf } from '../element-brand'

describe('an element’s brand layer', () => {
  it('reads an exact value as what the row has from the brand', () => {
    const design = defaultDesign()
    design.tune = { button: { radius: 14, fill: 'support' }, card: { border: 2, shadow: 'deep' } }
    expect(brandOf(design, 'button', 'radius')).toBe(14)
    expect(brandOf(design, 'button', 'background')).toBe('support')
    expect(brandOf(design, 'postCard', 'borderWidth')).toBe(2)
    expect(brandOf(design, 'panel', 'shadow')).toBe('deep')
  })

  it('gives a button its own label weight before the shared label one', () => {
    const design = defaultDesign()
    design.tune = { label: { weight: 500 } }
    expect(brandOf(design, 'button', 'weight')).toBe(500)
    expect(brandOf(design, 'navItem', 'weight')).toBe(500)
    design.tune = { label: { weight: 500 }, button: { weight: 700 } }
    expect(brandOf(design, 'button', 'weight')).toBe(700)
    expect(brandOf(design, 'navItem', 'weight')).toBe(500)
  })

  it('says exact capitals and underlines in the style’s own words', () => {
    const design = defaultDesign()
    design.tune = { button: { case: 'upper' }, link: { underline: 'never' } }
    expect(brandOf(design, 'button', 'case')).toBe('upper')
    expect(brandOf(design, 'link', 'underline')).toBe('none')
    design.tune = { link: { underline: 'hover' } }
    // Only on pointer over has no one style value.
    expect(brandOf(design, 'link', 'underline')).toBeUndefined()
  })

  it('reads the brand’s choices where no exact value is set', () => {
    const design = defaultDesign()
    design.brand.fonts.headlineColour = 'accent'
    design.brand.fonts.labelCase = 'upper'
    design.shape.buttons = 'pill'
    expect(brandOf(design, 'headline', 'color')).toBe('accent')
    expect(brandOf(design, 'button', 'case')).toBe('upper')
    expect(brandOf(design, 'navItem', 'case')).toBe('upper')
    expect(brandOf(design, 'button', 'radius')).toBe(999)
    design.tune = { headline: { colour: 'support' } }
    expect(brandOf(design, 'headline', 'color')).toBe('support')
  })

  it('lists and clears the exact values an element has, leaving others', () => {
    const design = defaultDesign()
    design.tune = { button: { radius: 14, height: 40 }, label: { size: 15 }, card: { radius: 4 } }
    expect(exactValuesOf(design, 'button').map((v) => `${v.group}.${v.key}`)).toEqual([
      'button.radius',
      'button.height',
      'label.size',
    ])
    expect(exactValuesOf(design, 'link')).toEqual([])
    clearExactValues(design, 'button')
    expect(design.tune).toEqual({ card: { radius: 4 } })
  })
})
