/**
 * A brand match owns the brand palette: matched onto a design an earlier
 * match set, every brand colour the new site gives no evidence for goes back
 * to the default (or is worked out from the new palette), never kept from
 * the earlier brand: a second colour, the text colour, further logo colours,
 * the logo's colours, the exact button and link colours, the band's action.
 */
import { describe, expect, it } from 'vitest'
import { applyDesignChanges } from '@/lib/shared/design/apply-changes'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import type { Box, BoxKind } from '../../extract/kinds'
import type { Image } from '../../extract/png'
import { colourEvidence, decideRoles } from '../../extract/roles'
import { rolesToDesign } from '../../extract/roles-design'
import { colourChanges } from '../brand-decide'

type Fill = [number, number, number]
const W = 960
const H = 600

function rect(img: Image, [x0, y0, x1, y1]: Box, c: Fill) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4)
}
function text(img: Image, [x0, y0, x1, y1]: Box, ink: Fill) {
  for (let x = x0; x + 3 < x1; x += 6) {
    if (Math.floor((x - x0) / 36) % 4 === 3) continue
    rect(img, [x + 1, y0, x + 3, y1], ink)
  }
}

/** A white page, mid-grey text, one green button and a green logo: no second colour, no near-black ink. */
function greenSite() {
  const data = new Uint8Array(W * H * 4).fill(255)
  const img: Image = { width: W, height: H, data }
  const GREEN: Fill = [22, 120, 60]
  const GREY: Fill = [70, 72, 76]
  rect(img, [32, 20, 112, 44], GREEN)
  text(img, [400, 26, 600, 38], GREY)
  text(img, [64, 140, 620, 190], GREY)
  text(img, [64, 210, 460, 222], GREY)
  rect(img, [400, 260, 540, 300], GREEN)
  text(img, [416, 274, 524, 286], [255, 255, 255])
  const boxes: Partial<Record<BoxKind, Box | null>> = {
    header: [0, 0, W, 64],
    logo: [32, 20, 112, 44],
    nav_row: [400, 26, 600, 38],
    hero: [0, 64, W, 420],
    headline: [64, 140, 620, 190],
    subtitle: [64, 210, 460, 222],
    primary_button: [400, 260, 540, 300],
  }
  return decideRoles(colourEvidence([{ img, boxes, behind: 'plain' }]))
}

/** A design an earlier match left: Paylane-like navy text, an orange second colour, and more. */
function earlierMatch(): PortalDesign {
  const d = defaultDesign()
  d.brand.light.accent = '#533afb'
  d.brand.light.ink = '#030624'
  d.brand.light.background = '#fafaf7'
  d.brand.light.support = '#fd9330'
  d.brand.light.extra = ['#00d4ff']
  d.brand.logoColours = ['#06172e']
  d.shape.action = 'support'
  d.tune = { ...d.tune, button: { fill: '#8a8a8a', ink: '#111111' }, link: { colour: '#222222' } }
  return d
}

describe('a brand match onto a design an earlier match set', () => {
  it('leaves none of the earlier brand’s colours the new site gives no evidence for', () => {
    const roles = greenSite()
    expect(roles.highlight.value).toBeNull()
    const { design, refused } = applyDesignChanges(
      earlierMatch(),
      colourChanges(roles, rolesToDesign(roles)).map(({ path, value }) => ({ path, value })),
      'site'
    )
    expect(refused).toEqual([])
    const fresh = defaultDesign()
    expect(design.brand.light.support).toBeUndefined()
    expect(design.brand.light.extra).toBeUndefined()
    expect(design.brand.light.ink).toBe(fresh.brand.light.ink)
    expect(design.brand.light.background).toBe(fresh.brand.light.background)
    expect(design.brand.logoColours ?? null).not.toEqual(['#06172e'])
    expect(design.shape.action).toBeUndefined()
    expect(design.tune?.button?.fill).toBeUndefined()
    expect(design.tune?.link?.colour).toBeUndefined()
  })

  it('clears dark mode’s colours a light site gives no evidence for, so dark is worked out from light', () => {
    const roles = greenSite()
    const earlier = earlierMatch()
    // A workspace converted from today's branding carries the default dark yellow.
    earlier.brand.dark = {
      accent: 'oklch(0.886 0.176 86)',
      background: '#0a0a0a',
      ink: '#fafafa',
      support: '#ffcc00',
    }
    for (const mode of ['auto', 'light'] as const) {
      const { design, refused } = applyDesignChanges(
        { ...earlier, mode },
        colourChanges(roles, rolesToDesign(roles), mode).map(({ path, value }) => ({
          path,
          value,
        })),
        'site'
      )
      expect(refused).toEqual([])
      expect(design.brand.dark).toBeUndefined()
      expect(design.mode).toBe(mode)
    }
  })
})
