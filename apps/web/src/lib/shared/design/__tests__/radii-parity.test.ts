/**
 * The corner sizes components.ts writes in rem and the px effective-values.ts
 * shows and Quackback AI reads are two tables of the same steps; this keeps
 * them the same, so the px shown is the px drawn.
 */
import { describe, expect, it } from 'vitest'
import { BUTTON_RADII, RADII } from '../components'
import { BUTTON_PX, RADII_PX } from '../effective-values'

const px = (css: string) =>
  css.endsWith('rem') ? Number.parseFloat(css) * 16 : Number.parseFloat(css)

describe('corner sizes', () => {
  it('gives each corners choice the same px in both tables', () => {
    expect(Object.keys(RADII).sort()).toEqual(Object.keys(RADII_PX).sort())
    for (const [corners, [control, field, panel]] of Object.entries(RADII)) {
      expect({ control: px(control), field: px(field), panel: px(panel) }, corners).toEqual(
        RADII_PX[corners as keyof typeof RADII_PX]
      )
    }
  })

  it('gives each button shape the same px in both tables', () => {
    expect(Object.keys(BUTTON_RADII).sort()).toEqual(
      Object.keys(BUTTON_PX)
        .filter((k) => k !== 'match')
        .sort()
    )
    for (const [shape, [button]] of Object.entries(BUTTON_RADII))
      expect(px(button), shape).toBe(BUTTON_PX[shape as keyof typeof BUTTON_PX])
  })
})
