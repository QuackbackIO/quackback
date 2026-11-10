/**
 * The logo is an icon and a title, or a full logo image kept for designs
 * that have one. Setting either brings both into view on a design that
 * showed only one, and an image's ink is measured so it can sit on a tile
 * where the header would swallow it.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '../schema'
import { logoInk, setIcon, setLogoInk, setTitle, showFullLogo } from '../logo'

/** RGBA pixels: `n` of one colour and `clear` transparent ones. */
const pixels = (rgba: [number, number, number, number], n: number, clear = 0) => {
  const data = new Uint8ClampedArray((n + clear) * 4)
  for (let i = 0; i < n; i++) data.set(rgba, i * 4)
  return data
}

describe('the icon and the title', () => {
  it('sets the icon with its ink, and shows the icon and title on a design that showed one', () => {
    const design = defaultDesign()
    design.brand.logo.display = 'name'
    setIcon(design, { key: 'logos/icon.png' }, 'dark')
    expect(design.brand.logo).toMatchObject({
      mark: { light: { key: 'logos/icon.png' } },
      display: 'mark_and_name',
      tone: 'dark',
    })
    setIcon(design, null, null)
    expect(design.brand.logo.mark.light).toBeNull()
    expect(design.brand.logo).not.toHaveProperty('tone')
  })

  it('forgets that an earlier logo was one ink when a new image is set', () => {
    const design = defaultDesign()
    design.brand.logo.tone = 'dark'
    design.brand.logo.oneInk = true
    setIcon(design, { key: 'logos/icon.png' }, 'dark')
    expect(design.brand.logo).not.toHaveProperty('oneInk')
    design.brand.logo.oneInk = true
    setLogoInk(design.brand.logo, 'light')
    expect(design.brand.logo.tone).toBe('light')
    expect(design.brand.logo).not.toHaveProperty('oneInk')
    setLogoInk(design.brand.logo, null)
    expect(design.brand.logo).not.toHaveProperty('tone')
  })

  it('leaves a full logo design showing its full logo when the icon changes', () => {
    const design = defaultDesign()
    design.brand.logo.display = 'wordmark'
    design.brand.logo.tone = 'light'
    setIcon(design, { key: 'logos/icon.png' }, 'dark')
    expect(design.brand.logo.display).toBe('wordmark')
    expect(design.brand.logo.tone).toBe('light')
  })

  it('keeps a title, and an empty one goes back to the workspace name', () => {
    const design = defaultDesign()
    design.brand.logo.display = 'mark'
    setTitle(design, 'Harbor Help')
    expect(design.brand.logo).toMatchObject({ name: 'Harbor Help', display: 'mark_and_name' })
    setTitle(design, '  ')
    expect(design.brand.logo).not.toHaveProperty('name')
  })

  it('switches to a full logo image and back', () => {
    const design = defaultDesign()
    showFullLogo(design, true)
    expect(design.brand.logo.display).toBe('wordmark')
    showFullLogo(design, false)
    expect(design.brand.logo.display).toBe('mark_and_name')
  })
})

describe('a logo image’s ink', () => {
  it('is dark or light for one ink on a clear background', () => {
    expect(logoInk(pixels([20, 20, 30, 255], 40, 60))).toBe('dark')
    expect(logoInk(pixels([250, 250, 250, 255], 40, 60))).toBe('light')
  })

  it('is dark where much of the ink would vanish on a dark header, beside brighter colours', () => {
    // A black name beside a white badge and a bright mark: the name vanishes on a dark header.
    const data = new Uint8ClampedArray([
      ...pixels([0, 0, 0, 255], 45),
      ...pixels([255, 255, 255, 255], 25),
      ...pixels([255, 144, 232, 255], 20),
      ...pixels([0, 0, 0, 0], 60),
    ])
    expect(logoInk(data)).toBe('dark')
  })

  it('is unknown for a mid colour, or an image with its own background', () => {
    expect(logoInk(pixels([230, 80, 30, 255], 40, 60))).toBeNull()
    // A crop from a screenshot carries its page behind the mark: it is its own tile.
    expect(logoInk(pixels([20, 20, 30, 255], 100, 0))).toBeNull()
    expect(logoInk(new Uint8ClampedArray(0))).toBeNull()
  })
})
