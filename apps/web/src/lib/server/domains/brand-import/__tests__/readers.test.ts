import { BRAND_READER_NAME } from '@/lib/shared/theme/brand-import'
import { READER_TOKEN } from '../robots'
import { describe, expect, it } from 'vitest'
import { mergeBrandReads } from '../readers'

describe('mergeBrandReads', () => {
  it('keeps the preferred values and fills gaps from the fallback, field by field', () => {
    const merged = mergeBrandReads(
      {
        page: { background: '#08090a' },
        button: { fill: '#e5e5e6', radiusPx: 9999, heightPx: 32 },
        fonts: { body: { family: 'Inter', stack: 'Inter, sans-serif' } },
      },
      {
        title: 'Acme',
        page: { background: '#ffffff', text: '#222222' },
        themeColor: '#08090a',
        fonts: { headline: { family: 'Lora', stack: 'Lora, serif' } },
        palette: [{ hex: '#1f4d3a', share: 1 }],
      }
    )
    expect(merged).toEqual({
      title: 'Acme',
      page: { background: '#08090a', text: '#222222' },
      button: { fill: '#e5e5e6', radiusPx: 9999, heightPx: 32 },
      fonts: {
        body: { family: 'Inter', stack: 'Inter, sans-serif' },
        headline: { family: 'Lora', stack: 'Lora, serif' },
      },
      themeColor: '#08090a',
      palette: [{ hex: '#1f4d3a', share: 1 }],
    })
  })

  it('takes a logo whole, never mixing two', () => {
    const merged = mergeBrandReads(
      { logo: { widthPx: 88, heightPx: 22, from: 'header-img' } },
      { logo: { svg: '<svg/>', widthPx: 10, heightPx: 10, from: 'header-svg' } }
    )
    expect(merged.logo).toEqual({ widthPx: 88, heightPx: 22, from: 'header-img' })
  })

  it('carries the logo colour across', () => {
    expect(mergeBrandReads({ logoColour: '#ff385c' }, {}).logoColour).toBe('#ff385c')
    expect(mergeBrandReads({}, { logoColour: '#0061fe' }).logoColour).toBe('#0061fe')
  })

  it('takes a dark mode whole, from the reader that saw one', () => {
    const dark = { page: { background: '#1d1f27' as const } }
    expect(mergeBrandReads({}, { dark }).dark).toEqual(dark)
  })

  it('carries the declared name, the headings font and the cards’ look across', () => {
    const font = { family: 'Northwind Display', notCopied: 'service' as const }
    const merged = mergeBrandReads(
      { siteHeadingFont: font, card: { looks: { border: 0, shadow: 300, flat: 0 } } },
      { siteName: 'Northwind', card: { radiusPx: 8 } }
    )
    expect(merged.siteName).toBe('Northwind')
    expect(merged.siteHeadingFont).toEqual(font)
    expect(merged.card).toEqual({ radiusPx: 8, looks: { border: 0, shadow: 300, flat: 0 } })
  })

  it('lists both readers’ declared names, the preferred reader’s first, each once', () => {
    expect(
      mergeBrandReads({ names: ['Acme', 'Acme App'] }, { names: ['Acme Parcel', 'Acme'] }).names
    ).toEqual(['Acme', 'Acme App', 'Acme Parcel'])
    expect(mergeBrandReads({}, {}).names).toBeUndefined()
  })

  it('the reader goes by one name: in robots.txt, to the sites it reads, and in the editor', () => {
    expect(BRAND_READER_NAME).toBe(READER_TOKEN)
  })
  it('takes the header bar from the rendered read alone when it read a page', () => {
    const fromCss = { page: { background: '#ffffff' as const, header: '#0b1f3a' as const } }
    // The rendered page's bar shows the page (no fill of its own): not a gap to fill.
    expect(
      mergeBrandReads({ page: { background: '#ffffff' } }, fromCss).page?.header
    ).toBeUndefined()
    expect(
      mergeBrandReads({ page: { background: '#ffffff', header: '#005eb8' } }, fromCss).page?.header
    ).toBe('#005eb8')
    // No rendered page at all: the stylesheet's bar stands.
    expect(mergeBrandReads({ title: 'Acme' }, fromCss).page?.header).toBe('#0b1f3a')
  })
})
