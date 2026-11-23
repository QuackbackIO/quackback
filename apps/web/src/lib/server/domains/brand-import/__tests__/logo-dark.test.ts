/**
 * Which of a site's logos Import takes as the dark mode version: only one
 * the site itself shows or marks for dark mode, only when it is another
 * picture than the logo, and only when it would show on a dark header.
 * Nothing is recoloured: a candidate that would not show leaves the slot empty.
 */
import { describe, expect, it } from 'vitest'
import type { BrandRead } from '@/lib/shared/theme/brand-import'
import { siteDarkLogo } from '../logo-dark'

const DARK_BAR = '#0a0a0a'
const size = { widthPx: 120, heightPx: 30, from: 'header-img' as const }
const ink = (color: `#${string}`) => [{ color, share: 1 }]
const png = (...bytes: number[]) => ({ bytes: Uint8Array.from(bytes), mime: 'image/png' })
const read = (
  darkLogo: NonNullable<BrandRead['darkLogo']>,
  logo?: BrandRead['logo']
): BrandRead => ({
  logo: logo ?? { raster: png(1, 2, 3), ...size, inks: ink('#17332b') },
  darkLogo,
})

describe('siteDarkLogo', () => {
  it('takes the logo the site shows a dark system, when it shows on a dark header', () => {
    const dark = { raster: png(9, 9, 9), ...size, inks: ink('#e8f1ee'), how: 'scheme' as const }
    expect(siteDarkLogo(read(dark), DARK_BAR)).toBe(dark)
  })

  it('takes a picture’s dark source the reader could not draw, on the site’s word', () => {
    const dark = { raster: png(9, 9, 9), ...size, how: 'picture' as const }
    expect(siteDarkLogo(read(dark), DARK_BAR)).toBe(dark)
  })

  it('takes a twin marked for dark mode only when its inks say it shows there', () => {
    const twin = { raster: png(9, 9, 9), ...size, how: 'pair' as const }
    // "logo-dark" may as well name the dark-coloured logo: unmeasured, it is left.
    expect(siteDarkLogo(read(twin), DARK_BAR)).toBeNull()
    expect(siteDarkLogo(read({ ...twin, inks: ink('#101010') }), DARK_BAR)).toBeNull()
    const pale = { ...twin, inks: ink('#fafafa') }
    expect(siteDarkLogo(read(pale), DARK_BAR)).toBe(pale)
  })

  it('leaves the slot empty for a candidate that would not show, and never redraws it', () => {
    const svg = '<svg viewBox="0 0 9 3"><path d="M0 0h9" fill="#111111"/></svg>'
    expect(siteDarkLogo(read({ svg, ...size, how: 'scheme' }), DARK_BAR)).toBeNull()
    expect(
      siteDarkLogo(read({ raster: png(9), ...size, inks: ink('#0a0a0a'), how: 'scheme' }), DARK_BAR)
    ).toBeNull()
    const white = { svg: svg.replace('#111111', '#ffffff'), ...size, how: 'scheme' as const }
    expect(siteDarkLogo(read(white), DARK_BAR)).toBe(white)
  })

  it('has none when it is the logo itself, or there is no logo to stand in for', () => {
    const same = { raster: png(1, 2, 3), ...size, inks: ink('#fafafa'), how: 'scheme' as const }
    expect(siteDarkLogo(read(same), DARK_BAR)).toBeNull()
    const svg = '<svg viewBox="0 0 9 3"><path d="M0 0h9" fill="#ffffff"/></svg>'
    expect(
      siteDarkLogo(read({ svg, ...size, how: 'scheme' }, { svg, ...size }), DARK_BAR)
    ).toBeNull()
    expect(siteDarkLogo({ darkLogo: same }, DARK_BAR)).toBeNull()
    expect(siteDarkLogo({ logo: { raster: png(1), ...size } }, DARK_BAR)).toBeNull()
  })
})
