/**
 * The text colour a light site is read in becomes the portal's ink where it
 * is dark enough to set headlines in: a charcoal, not only a near black. A
 * mid grey (a softer body text read as the darkest) is not an ink, nor is a
 * dark green or navy (a headline's own colour, set there), so the default
 * stands.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
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

/** A white page with its type in one colour, a green button and a green logo. */
function siteWithText(ink: Fill) {
  const data = new Uint8Array(W * H * 4).fill(255)
  const img: Image = { width: W, height: H, data }
  const GREEN: Fill = [22, 120, 60]
  rect(img, [32, 20, 112, 44], GREEN)
  text(img, [400, 26, 600, 38], ink)
  text(img, [64, 140, 620, 190], ink)
  text(img, [64, 210, 460, 222], ink)
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

const inkSet = (ink: Fill) => {
  const roles = siteWithText(ink)
  const changes = colourChanges(roles, rolesToDesign(roles))
  return { roles, ink: changes.find((c) => c.path === 'brand.light.ink')?.value }
}

describe('the ink a light site’s text gives the portal', () => {
  it('keeps a charcoal text as read, not the default near black', () => {
    const { roles, ink } = inkSet([34, 34, 34])
    expect(roles.scheme).toBe('light')
    expect(ink).toBe(roles.text)
    expect(ink).not.toBe(defaultDesign().brand.light.ink)
  })

  it('leaves a dark coloured text to the headline’s own colour: body text stays neutral', () => {
    const { ink } = inkSet([18, 48, 1])
    expect(ink).toBe(defaultDesign().brand.light.ink)
  })

  it('keeps a near black as before', () => {
    const { roles, ink } = inkSet([12, 12, 12])
    expect(ink).toBe(roles.text)
  })

  it('leaves a mid grey to the default: too soft for headlines', () => {
    const { ink } = inkSet([110, 110, 110])
    expect(ink).toBe(defaultDesign().brand.light.ink)
  })
})
