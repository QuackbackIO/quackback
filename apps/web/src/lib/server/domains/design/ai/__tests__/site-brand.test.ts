/**
 * A page's brand from what it serves: colours weighed by where they appear,
 * the page background, fonts with system and icon fonts left out, and pages
 * that are a bot check rather than the site.
 */
import { describe, expect, it } from 'vitest'
import { isBlockPage, pageLinks, readSiteBrand } from '../site-brand'

describe('readSiteBrand', () => {
  it('takes the brand colour from where the site names it over how often a colour appears', () => {
    const brand = readSiteBrand({
      html: '<html><head><meta name="theme-color" content="#E11D48"></head></html>',
      css: ['.a{color:#2563eb}.b{color:#2563eb}.c{color:#2563eb}.d{border-color:#2563eb}'],
      manifest: null,
    })
    expect(brand.colour).toBe('#e11d48')
    expect(brand.palette).toEqual(['#e11d48', '#2563eb'])
  })

  it('reads a dark page, colours in any notation, and skips system, icon and generic fonts', () => {
    const brand = readSiteBrand({
      html: '',
      css: [
        'html { background-color: rgb(11, 16, 32); }',
        'body { font-family: -apple-system, "Segoe UI", sans-serif; }',
        '.icon { font-family: "Font Awesome 6 Free"; }',
        '.hero h1 { font: 700 64px/1 "Space Grotesk", system-ui; }',
        ':root { --accent-color: hsl(78, 100%, 62%); }',
      ],
      manifest: null,
    })
    expect(brand).toMatchObject({
      background: '#0b1020',
      dark: true,
      fonts: { heading: 'Space Grotesk', body: null },
      colour: '#c5ff3d',
    })
  })

  it('keeps colours apart in the palette and leaves greys out', () => {
    const brand = readSiteBrand({
      html: '',
      css: [':root{--primary:#0f766e;--primary-2:#0f776f;--muted:#6b7280} a{color:#b45309}'],
      manifest: null,
    })
    expect(brand.palette).toEqual(['#0f766e', '#b45309'])
  })
})

describe('how the site uses its colours', () => {
  it('knows black buttons, which mark a monochrome brand', () => {
    const brand = readSiteBrand({
      html: '',
      css: ['.button-primary { background-color: #000; color: #fff } a { color: #0077d4 }'],
      manifest: null,
    })
    expect(brand.button).toBe('#000000')
    expect(brand.colour).toBe('#0077d4')
    expect(brand).toMatchObject({ bold: false, monochrome: true })
  })

  it('leads with a colourful button fill, the brand’s own call to action', () => {
    const brand = readSiteBrand({
      html: '',
      css: [
        ':root { --accent-warm: #f5a623; --accent-gold: #f5a623 } .btn { background: #0075de }',
      ],
      manifest: null,
    })
    expect(brand).toMatchObject({ colour: '#0075de', monochrome: false })
  })

  it('reads the page as it first loads, not its dark mode', () => {
    const brand = readSiteBrand({
      html: '',
      css: [
        'body { background: #ffffff }',
        '@media (prefers-color-scheme: dark) { body { background: #000000 } .a { color: #fff } }',
        '[data-theme="dark"] body, .dark body { background: #111111 }',
      ],
      manifest: null,
    })
    expect(brand).toMatchObject({ background: '#ffffff', dark: false })
    const darkFirst = readSiteBrand({
      html: '',
      css: [
        '@media (prefers-color-scheme: dark) { html { background: #000 } }',
        'html { background: #fafafa }',
      ],
      manifest: null,
    })
    expect(darkFirst.background).toBe('#fafafa')
  })

  it('knows a brand colour that fills a hero', () => {
    const brand = readSiteBrand({
      html: '',
      css: [':root { --brand-primary: #9fe870 } .hero-section { background: #9fe870 }'],
      manifest: null,
    })
    expect(brand).toMatchObject({ colour: '#9fe870', bold: true })
  })
})

describe('colours that are not the brand', () => {
  it('leaves out focus rings, shadows and colours for errors and success, and puts buttons over links', () => {
    const brand = readSiteBrand({
      html: '',
      css: [
        ':focus-visible { outline: 3px solid #ffdd00; } a:focus { background: #ffdd00; color: #ffdd00 }',
        '.alert-error { color: #d4351c; } :root { --color-success: #00703c; --focus-ring: #ffdd00 }',
        '.card { box-shadow: 0 0 0 4px #ffdd00; }',
        'a { color: #4c2c92; } .button { background-color: #1d70b8; }',
      ],
      manifest: null,
    })
    expect(brand.palette).toEqual(['#1d70b8', '#4c2c92'])
  })
})

describe('isBlockPage', () => {
  it('knows a bot check or a refusal from the site', () => {
    expect(isBlockPage('<title>Just a moment...</title>')).toBe(true)
    expect(isBlockPage('<title>Unsupported client – Canva</title>')).toBe(true)
    expect(
      isBlockPage('<html><script src="/cdn-cgi/challenge-platform/x.js"></script></html>')
    ).toBe(true)
    expect(isBlockPage('<title>Allbirds: Comfortable shoes</title>')).toBe(false)
  })
})

describe('pageLinks', () => {
  it('finds stylesheets, preloaded styles and the manifest, resolved against the page', () => {
    const links = pageLinks(
      `<link rel="stylesheet" href="/a.css"><link rel="preload" as="style" href="https://cdn.example.com/b.css">
       <link rel="preload" as="font" href="/f.woff2"><link rel='manifest' href='/m.json'><style>a{color:red}</style>`,
      'https://example.com/shop/'
    )
    expect(links).toEqual({
      stylesheets: ['https://example.com/a.css', 'https://cdn.example.com/b.css'],
      manifest: 'https://example.com/m.json',
      inlineCss: 'a{color:red}',
    })
  })

  it('decodes a page’s entities once, so an escaped one stays escaped', () => {
    const brand = readSiteBrand({
      html: '<title>Tools &amp;lt;b&amp;gt; &amp; more &#8212; &#x2014;</title>',
      css: [],
      manifest: null,
    })
    expect(brand.title).toBe('Tools &lt;b&gt; & more \u2014 \u2014')
  })
})
