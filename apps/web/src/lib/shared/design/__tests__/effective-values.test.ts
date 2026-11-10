import { describe, expect, it } from 'vitest'
import { brandValues, effectiveValues } from '../effective-values'
import { defaultDesign } from '../schema'

describe('effectiveValues', () => {
  it('reads what the choices give, and exact values over them', () => {
    const design = defaultDesign()
    design.brand.fonts.scale = 'large'
    expect(effectiveValues(design).headline.size).toBe(48)
    design.tune = { headline: { size: 52 } }
    expect(effectiveValues(design).headline.size).toBe(52)
    design.shape.buttons = 'pill'
    expect(effectiveValues(design).button.radius).toBe(999)
  })
})

describe('effectiveValues, reading the element looks first', () => {
  it('reads an element’s own look over the exact values and the choices', () => {
    const design = defaultDesign()
    design.tune = { headline: { size: 52, weight: 600 }, button: { radius: 4 } }
    design.style = {
      headline: { base: { size: 56, weight: 800, tracking: -0.04 } },
      heading: { base: { size: 22 } },
      navItem: { base: { size: 15, weight: 600 } },
      button: { base: { radius: 12, height: 44, background: '#112233' } },
      postCard: { base: { radius: 18 } },
      input: { base: { radius: 6 } },
    }
    const values = effectiveValues(design)
    expect(values.headline).toEqual({ size: 56, weight: 800, tracking: -0.04 })
    expect(values.heading.size).toBe(22)
    expect(values.label).toEqual({ size: 15, weight: 600 })
    expect(values.button).toEqual({ radius: 12, height: 44, fill: '#112233' })
    expect(values.card.radius).toBe(18)
    expect(values.field.radius).toBe(6)
  })

  it('reads a button fill named by its role as the brand’s colour', () => {
    const design = defaultDesign()
    design.style = { button: { base: { background: 'ink' } } }
    expect(effectiveValues(design).button.fill).toBe(design.brand.light.ink)
  })

  it('falls back past a look that is not a single colour, such as a gradient', () => {
    const design = defaultDesign()
    design.style = { button: { base: { background: { from: 'accent', to: 'support' } } } }
    expect(effectiveValues(design).button.fill).toBe(design.brand.light.accent)
  })
})

describe('brandValues', () => {
  it('is what the brand gives, never an element’s own look, which is set over it', () => {
    const design = defaultDesign()
    design.tune = { headline: { size: 52 } }
    design.style = { headline: { base: { size: 56 } }, postCard: { base: { radius: 18 } } }
    expect(brandValues(design).headline.size).toBe(52)
    expect(brandValues(design).card.radius).toBe(12)
  })
})
