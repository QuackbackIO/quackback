import { describe, expect, it } from 'vitest'
import {
  findHeaderLogo,
  findShareImage,
  imageSize,
  resolveSvgColours,
  safeSvg,
  svgAspect,
  svgColours,
  svgTone,
} from '../site-logo'

const BASE = 'https://www.example.com/'
const WORDMARK =
  '<svg viewBox="0 0 120 30"><path fill="var(--brand-ink)" d="M0 0h120v30H0z"/></svg>'

describe('finding a website’s header logo', () => {
  it('takes the inline SVG in an element marked as the logo', () => {
    const html = `<html><body><nav><a class="nav__logo" href="/en-gb/">${WORDMARK}</a></nav></body></html>`
    expect(findHeaderLogo(html, BASE)).toEqual({ svg: WORDMARK, classes: ['nav__logo'] })
  })

  it('takes the first link home when nothing is marked, skipping a wall of customer logos', () => {
    const html = `<header><a class="wall" href="/customers/acme"><img src="/acme.png"></a><a href="/"><svg viewBox="0 0 80 20"></svg></a></header>`
    expect(findHeaderLogo(html, BASE)).toEqual({ svg: '<svg viewBox="0 0 80 20"></svg>' })
  })

  it('prefers the dark-on-light image, at its sharpest', () => {
    const html = `<header><a data-qa="logo" href="https://www.example.com/">
      <img src="/img/logo-white.png">
      <img src="/img/logo-black.png" srcset="/img/logo-black.png 1x, /img/logo-black@2x.png 2x">
    </a></header>`
    expect(findHeaderLogo(html, BASE)).toEqual({
      url: 'https://www.example.com/img/logo-black@2x.png',
    })
  })

  it('reads a label naming home, and an image marked as the logo on its own', () => {
    expect(
      findHeaderLogo(`<a aria-label="Example – Home" href="/product">${WORDMARK}</a>`, BASE)
    ).toEqual({ svg: WORDMARK })
    expect(findHeaderLogo('<img class="site-logo" src="/brand.svg">', BASE)).toEqual({
      url: 'https://www.example.com/brand.svg',
    })
  })

  it('finds nothing on a page that marks no logo', () => {
    expect(findHeaderLogo('<header><a href="/pricing">Pricing</a></header>', BASE)).toBeNull()
  })
})

describe('a website’s share image', () => {
  it('is its og:image, else its twitter:image, as an absolute address', () => {
    expect(findShareImage('<meta content="/og.jpg" property="og:image">', BASE)).toBe(
      'https://www.example.com/og.jpg'
    )
    expect(
      findShareImage('<meta name="twitter:image" content="https://cdn.example.com/t.png">', BASE)
    ).toBe('https://cdn.example.com/t.png')
    expect(findShareImage('<meta property="og:title" content="x">', BASE)).toBeNull()
  })
})

describe('an inline SVG copied out of its page', () => {
  it('takes its custom properties from the site’s CSS, not its dark mode', () => {
    const css = [
      '@media (prefers-color-scheme: dark) { :root { --brand-ink: #ffffff } }',
      ':root { --brand-ink: var(--green-900); --green-900: #163300 }',
    ]
    expect(resolveSvgColours(WORDMARK, css, '#ff4f40')).toContain('fill="#163300"')
  })

  it('draws currentColor in the colour the site gives the logo’s own class', () => {
    const css = ['.Header_logo__x9{display:flex;color:#ff4f40}', '.other{color:#111}']
    expect(
      resolveSvgColours('<svg fill="currentColor"/>', css, '#112231', ['Header_logo__x9'])
    ).toBe('<svg fill="#ff4f40"/>')
  })

  it('takes a property’s fallback, and the brand colour for currentColor or an unknown property', () => {
    expect(resolveSvgColours('<svg fill="var(--x, #031323)"/>', [], '#ff4f40')).toBe(
      '<svg fill="#031323"/>'
    )
    expect(resolveSvgColours('<svg fill="currentColor" stroke="var(--y)"/>', [], '#ff4f40')).toBe(
      '<svg fill="#ff4f40" stroke="#ff4f40"/>'
    )
  })
})

describe('storing an SVG', () => {
  it('gives it its namespace', () => {
    expect(safeSvg('<svg viewBox="0 0 1 1"/>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>'
    )
  })

  it('refuses anything that runs, embeds or reaches out', () => {
    for (const svg of [
      '<svg><script>alert(1)</script></svg>',
      '<svg onload="alert(1)"/>',
      '<svg><foreignObject></foreignObject></svg>',
      '<svg><a href="javascript:alert(1)"/></svg>',
      '<svg><image href="https://tracker.example.com/x.png"/></svg>',
      '<!DOCTYPE svg><svg/>',
      '<html><svg/></html>',
    ])
      expect(safeSvg(svg), svg).toBeNull()
  })

  it('reads how wide it draws, and its own colours', () => {
    expect(svgAspect(WORDMARK)).toBe(4)
    expect(svgAspect('<svg width="33" height="34"/>')).toBeCloseTo(0.97)
    expect(
      svgColours(
        '<svg><path fill="#36C5F0"/><path style="fill:#e01e5a"/><path fill="#111111"/><path fill="#fff"/></svg>'
      )
    ).toEqual(['#36c5f0', '#e01e5a'])
  })
})

describe('an image file’s size', () => {
  it('reads PNG, GIF and JPEG headers', () => {
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47], 0)
    new DataView(png.buffer).setUint32(16, 201)
    new DataView(png.buffer).setUint32(20, 75)
    expect(imageSize(png)).toEqual({ width: 201, height: 75 })
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xc8, 0x00])
    expect(imageSize(gif)).toEqual({ width: 320, height: 200 })
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x76,
      0x04, 0x4c,
    ])
    expect(imageSize(jpeg)).toEqual({ width: 1100, height: 630 })
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

describe('a logo’s ink', () => {
  it('is dark or light when every colour is, and unknown when mixed', () => {
    expect(svgTone('<svg><path fill="#163300"/><path fill="#000"/></svg>')).toBe('dark')
    expect(svgTone('<svg><path fill="#ffffff"/></svg>')).toBe('light')
    expect(svgTone('<svg><path fill="#ecb22e"/><path fill="#1d1c1d"/></svg>')).toBeNull()
    expect(svgTone('<svg/>')).toBeNull()
  })
})
