import { describe, expect, it } from 'vitest'
import { effectiveValues } from '../effective-values'
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
