import { describe, expect, it } from 'vitest'
import { mapBrandRead } from '@/lib/shared/theme/brand-import'
import { brandReadFromSite } from '../static-reader'
import type { SiteAsset } from '../site/types'
import {
  brandAndButton,
  bundledHeadingFace,
  harborSite,
  monochrome,
  systemFonts,
  themeOnly,
} from '../site/__tests__/fixtures/harbor-site'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 32"><path d="M0 0h1"/></svg>'
const asset = (over: Partial<SiteAsset>): SiteAsset => ({
  url: 'https://www.harborandpine.example/logo.svg',
  mime: 'image/svg+xml',
  bytes: new TextEncoder().encode(svg),
  width: 120,
  height: 32,
  from: 'header-svg',
  ...over,
})

describe('brandReadFromSite', () => {
  it('reads nothing from a site with no facts', () => {
    expect(brandReadFromSite({ ...harborSite(), facts: null })).toEqual({})
  })

  it('gives the colour candidates as a palette, strongest first', () => {
    const read = brandReadFromSite(brandAndButton())
    expect(read.palette).toEqual([
      { hex: '#1f4d3a', share: 0.6 },
      { hex: '#c2410c', share: 0.4 },
    ])
    expect(mapBrandRead(read).primary).toBe('#1f4d3a')
  })

  it('gives the theme colour', () => {
    expect(brandReadFromSite(themeOnly()).themeColor).toBe('#2563eb')
    expect(mapBrandRead(brandReadFromSite(monochrome())).primary).toBe('#111111')
  })

  it('leaves out a white or grey theme colour when the CSS names a brand colour', () => {
    expect(
      brandReadFromSite({
        ...brandAndButton(),
        facts: { ...brandAndButton().facts, themeColour: '#ffffff' },
      }).themeColor
    ).toBeUndefined()
    expect(
      brandReadFromSite({
        ...brandAndButton(),
        facts: { ...brandAndButton().facts, themeColour: '#2563eb' },
      }).themeColor
    ).toBe('#2563eb')
    // A monochrome brand names nothing else: its near-black stands.
    expect(brandReadFromSite(monochrome()).themeColor).toBe('#111111')
    // White is never a main colour.
    expect(brandReadFromSite(harborSite({ themeColour: '#ffffff' })).themeColor).toBeUndefined()
  })

  it('gives the body and heading font stacks', () => {
    const read = brandReadFromSite(bundledHeadingFace())
    expect(read.fonts).toEqual({
      body: { family: 'Inter', stack: 'Inter, sans-serif' },
      headline: { family: 'Playfair Display', stack: 'Playfair Display, serif' },
    })
    expect(mapBrandRead(brandReadFromSite(systemFonts())).font).toEqual({
      id: 'system',
      exact: true,
    })
  })

  it('gives the page colours, main button and card the stylesheets name', () => {
    const read = brandReadFromSite(
      harborSite({
        style: {
          background: '#fffefb',
          text: '#111111',
          button: { fill: '#111111', radiusPercent: 50 },
          cardRadiusPx: 14,
          header: '#0b1f3a',
        },
      })
    )
    expect(read).toMatchObject({
      page: { background: '#fffefb', text: '#111111', header: '#0b1f3a' },
      button: { fill: '#111111', radiusPercent: 50 },
      card: { radiusPx: 14 },
    })
    expect(mapBrandRead(read)).toMatchObject({
      primary: '#111111',
      buttonShape: 'pill',
      radius: 1,
      tokens: { header: '#0b1f3a' },
    })
  })

  it('gives no page colours or shapes when the stylesheets name none', () => {
    const draft = mapBrandRead(brandReadFromSite(brandAndButton()))
    expect(draft.missing).toEqual(['logo', 'page', 'font', 'shape'])
    expect(draft.background).toBeUndefined()
    expect(draft.radius).toBeUndefined()
  })

  it('gives a header SVG as sanitised markup with its drawn size', () => {
    const read = brandReadFromSite(harborSite({ logo: asset({}) }))
    expect(read.logo).toEqual({ svg, widthPx: 120, heightPx: 32, from: 'header-svg' })
    expect(mapBrandRead(read).logo).toEqual({ kind: 'wide' })
  })

  it('gives a header or declared logo image as verified bytes', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const read = brandReadFromSite(
      harborSite({
        logo: asset({ mime: 'image/png', bytes, width: 64, height: 64, from: 'json-ld' }),
      })
    )
    expect(read.logo).toEqual({
      raster: { bytes, mime: 'image/png' },
      widthPx: 64,
      heightPx: 64,
      from: 'header-img',
    })
  })

  it('never takes the favicon or a share image as the logo; the app icon is read on its own', () => {
    const favicon = asset({ mime: 'image/png', bytes: new Uint8Array([1]), from: 'icon' })
    const share = asset({ from: 'og-image', mime: 'image/png', bytes: new Uint8Array([2]) })
    expect(brandReadFromSite({ ...harborSite({ logo: share }), favicon }).logo).toBeUndefined()
    const appIcon = asset({
      mime: 'image/png',
      bytes: new Uint8Array([3]),
      from: 'apple-touch-icon',
    })
    expect(brandReadFromSite({ ...harborSite(), icon: appIcon }).icon).toEqual({
      raster: { bytes: appIcon.bytes, mime: 'image/png' },
      widthPx: appIcon.width,
      heightPx: appIcon.height,
    })
  })
})
