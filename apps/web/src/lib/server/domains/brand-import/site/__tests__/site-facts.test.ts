import { describe, expect, it } from 'vitest'
import {
  hostedFontFamilies,
  inlineStyles,
  manifestIcons,
  manifestName,
  nameFromTitle,
  parseSiteFacts,
  stylesheetLinks,
} from '../site-facts'

const BASE = 'https://acme.test/'

const doc = (head: string, body = '', htmlAttrs = 'lang="en-GB"') =>
  `<!doctype html><html ${htmlAttrs}><head>${head}</head><body>${body}</body></html>`

const LOGO_SVG =
  '<svg viewBox="0 0 120 32" role="img"><title>Acme Parcel</title><path d="M0 0h120v32H0z" fill="currentColor"/></svg>'
const MENU_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>'

describe('nameFromTitle', () => {
  it.each([
    ['Acme Parcel | Parcels, delivered the same day', 'https://acme.test/', 'Acme Parcel'],
    ['Same-day parcel delivery - Acme Parcel', 'https://acmeparcel.test/', 'Acme Parcel'],
    ['Home | Nimbus Tea', 'https://nimbus.example/', 'Nimbus Tea'],
    ['Nimbus Tea: loose leaf tea, sent monthly', 'https://shop.example/', 'Nimbus Tea'],
    ['Nimbus Tea \u2014 Loose leaf tea from small gardens', 'https://other.example/', 'Nimbus Tea'],
    ['Acme Parcel', 'https://acme.test/', 'Acme Parcel'],
    ['Welcome', 'https://acme.test/', null],
  ])('%s is %s', (title, base, name) => {
    expect(nameFromTitle(title, base)).toBe(name)
  })

  // A title that is a sentence names the brand somewhere in it, or not at all.
  it.each([
    ['Welcome to GOV.UK', 'https://www.gov.uk/', 'GOV.UK'],
    [
      'Official Skyline website | Book direct for the lowest fares | Skyline.com',
      'https://www.skyline.example/',
      'Skyline',
    ],
    [
      'Latest news, sport and opinion from the Courier',
      'https://www.thecourier.example/',
      'The Courier',
    ],
    ['Nimbus Outdoor Clothing & Gear', 'https://www.nimbus.example/', 'Nimbus'],
    ['Nimbus.example. Spend less. Smile more.', 'https://www.nimbus.example/', 'Nimbus.example'],
    ['Capture, organise, and tackle your to-dos from anywhere', 'https://nimbus.example/', null],
    ['Nimbus Coffee Company', 'https://www.nimbus.example/', 'Nimbus Coffee Company'],
  ])('%s at %s is %s', (title, base, name) => {
    expect(nameFromTitle(title, base)).toBe(name)
  })

  it('keeps hyphenated words whole', () => {
    expect(nameFromTitle('Hand-made tea', 'https://x.example/')).toBe('Hand-made tea')
  })
})

describe('parseSiteFacts basics', () => {
  it('prefers og:site_name for the name and reads lang and description', () => {
    const facts = parseSiteFacts(
      doc(
        '<title>Home | Acme</title><meta property="og:site_name" content="Acme Parcel"><meta name="description" content="Parcels, delivered.">'
      ),
      BASE,
      []
    )
    expect(facts).toMatchObject({
      url: BASE,
      name: 'Acme Parcel',
      nameFrom: 'og:site_name',
      language: 'en-gb',
      description: 'Parcels, delivered.',
    })
  })

  it('keeps the whole title and every name the page declares, the site’s first', () => {
    const facts = parseSiteFacts(
      doc(
        `<title>Send a parcel today | Acme</title><meta property="og:site_name" content="Love your parcels">
         <meta name="application-name" content="Acme App"><meta name="apple-mobile-web-app-title" content="Acme">
         <script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Acme Parcel Ltd' })}</script>`,
        '<header><a href="/"><img src="/logo.svg" alt="Acme Parcel logo"></a></header>'
      ),
      BASE,
      []
    )
    expect(facts.title).toBe('Send a parcel today | Acme')
    expect(facts.declaredNames).toEqual([
      'Love your parcels',
      'Acme Parcel Ltd',
      'Acme App',
      'Acme',
      'Acme Parcel',
    ])
  })

  it('reads the app’s name from a manifest: its name, else its short name', () => {
    expect(manifestName(JSON.stringify({ name: ' Acme  Parcel ', short_name: 'Acme' }))).toBe(
      'Acme Parcel'
    )
    expect(manifestName(JSON.stringify({ short_name: 'Acme' }))).toBe('Acme')
    expect(manifestName(JSON.stringify({ name: 7 }))).toBeNull()
    expect(manifestName('{ not json')).toBeNull()
  })

  it('falls back to the title, then to the header logo alt', () => {
    expect(parseSiteFacts(doc('<title>Acme Parcel | Fast</title>'), BASE, [])).toMatchObject({
      name: 'Acme Parcel',
      nameFrom: 'title',
    })
    const facts = parseSiteFacts(
      doc(
        '<title>Home</title>',
        '<header><a href="/"><img src="/logo.png" alt="Acme Parcel logo"></a></header>'
      ),
      BASE,
      []
    )
    expect(facts).toMatchObject({ name: 'Acme Parcel', nameFrom: 'logo-alt' })
  })

  it('reads theme-color in its forms, skipping a dark one when there are several', () => {
    const theme = (head: string) => parseSiteFacts(doc(head), BASE, []).themeColour
    expect(theme('<meta name="theme-color" content="#FE5E86">')).toBe('#fe5e86')
    expect(theme('<meta name="theme-color" content="rgb(34, 124, 153)">')).toBe('#227c99')
    expect(
      theme(
        '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000"><meta name="theme-color" media="(prefers-color-scheme: light)" content="#123abc">'
      )
    ).toBe('#123abc')
    expect(
      theme('<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#112233">')
    ).toBe('#112233')
    expect(theme('<meta name="theme-color" content="purple">')).toBeNull()
  })

  it('adds the theme colour to the colours at weight 1 unless it is neutral', () => {
    const colours = (head: string) => parseSiteFacts(doc(head), BASE, []).colours
    expect(colours('<meta name="theme-color" content="#fe5e86">')).toEqual([
      { hex: '#fe5e86', from: 'theme-color', weight: 1 },
    ])
    expect(colours('<meta name="theme-color" content="#ffffff">')).toEqual([])
  })

  it('never throws on garbage', () => {
    expect(() => parseSiteFacts('<<<>>>&#xffffffff;', 'not a url', [])).not.toThrow()
    expect(parseSiteFacts('', BASE, [])).toMatchObject({ name: null, logos: [], favicons: [] })
  })
})

describe('favicons and manifest', () => {
  it('lists icon and touch-icon links and records the manifest URL', () => {
    const facts = parseSiteFacts(
      doc(
        '<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/touch.png"><link rel="manifest" href="/site.webmanifest">'
      ),
      BASE,
      []
    )
    expect(facts.favicons).toEqual([
      { url: 'https://acme.test/favicon-32.png', size: 32, type: 'image/png', from: 'icon' },
      { url: 'https://acme.test/icon.svg', size: null, type: 'image/svg+xml', from: 'icon' },
      { url: 'https://acme.test/touch.png', size: null, type: null, from: 'apple-touch-icon' },
    ])
    expect(facts.manifest).toBe('https://acme.test/site.webmanifest')
  })

  it('reads manifest icons against the manifest URL, skipping monochrome ones', () => {
    const json = JSON.stringify({
      icons: [
        { src: 'icons/192.png', sizes: '192x192', type: 'image/png' },
        {
          src: '/icons/512.png',
          sizes: '512x512 256x256',
          type: 'image/png',
          purpose: 'any maskable',
        },
        { src: '/mono.png', sizes: '96x96', purpose: 'monochrome' },
        { src: 42 },
      ],
    })
    expect(manifestIcons(json, 'https://cdn.acme.test/app/site.webmanifest')).toEqual([
      {
        url: 'https://cdn.acme.test/app/icons/192.png',
        size: 192,
        type: 'image/png',
        from: 'manifest',
      },
      {
        url: 'https://cdn.acme.test/icons/512.png',
        size: 512,
        type: 'image/png',
        from: 'manifest',
      },
    ])
    expect(manifestIcons('not json', BASE)).toEqual([])
    expect(manifestIcons('{"icons": "x"}', BASE)).toEqual([])
  })
})

describe('local versions', () => {
  const links = (n: number) =>
    Array.from(
      { length: n },
      (_, i) => `<link rel="alternate" hreflang="xx-${i}" href="/v${i}/">`
    ).join('')

  it('reads the local versions a picker page names, absolute', () => {
    const facts = parseSiteFacts(
      `<html><head>${links(5)}<link rel="alternate" hreflang="en-GB" href="https://acme.test/gb/en/"></head><body></body></html>`,
      'https://acme.test/',
      []
    )
    expect(facts.localVersions).toContainEqual({ lang: 'en-gb', url: 'https://acme.test/gb/en/' })
    expect(facts.localVersions).toHaveLength(6)
  })

  it('names none for a page that is one of its own versions, or that names only a few', () => {
    const own = `<link rel="alternate" hreflang="en-GB" href="https://acme.test/gb/en/">${links(6)}`
    expect(
      parseSiteFacts(`<html><head>${own}</head></html>`, 'https://acme.test/gb/en/', [])
        .localVersions
    ).toEqual([])
    expect(
      parseSiteFacts(`<html><head>${links(2)}</head></html>`, 'https://acme.test/', [])
        .localVersions
    ).toEqual([])
  })
})

describe('logos', () => {
  it('finds an inline svg in a header link to the root', () => {
    const facts = parseSiteFacts(
      doc(
        '<title>Acme</title>',
        `<header class="top"><a href="/" aria-label="Acme Parcel home">${LOGO_SVG}</a><nav><a href="/pricing">Pricing</a></nav></header>`
      ),
      BASE,
      []
    )
    expect(facts.logos[0]).toEqual({
      from: 'header-svg',
      svg: LOGO_SVG,
      alt: 'Acme Parcel home',
      rank: 1,
    })
  })

  it('accepts an absolute or locale root link and an img logo with srcset', () => {
    const facts = parseSiteFacts(
      doc(
        '',
        `<div class="site-header"><a href="https://www.acme.test/en-gb/"><img src="/logo-1x.png" srcset="/logo-1x.png 1x, /logo-2x.png 2x" alt="Acme Parcel"></a></div>`
      ),
      'https://www.acme.test/',
      []
    )
    expect(facts.logos[0]).toEqual({
      from: 'header-img',
      url: 'https://www.acme.test/logo-2x.png',
      alt: 'Acme Parcel',
      rank: 2,
    })
  })

  it('skips links elsewhere and icon svgs', () => {
    const facts = parseSiteFacts(
      doc(
        '',
        `<nav><a href="/shop"><img src="/shop.png"></a><a href="/"><button type="button">${LOGO_SVG}</button></a><a href="/" class="burger">${MENU_SVG}</a><a href="/"><svg class="search-icon" viewBox="0 0 48 48"><path d="M1 1"/></svg></a><a href="/">${LOGO_SVG.replace('Acme Parcel', 'Acme')}</a></nav>`
      ),
      BASE,
      []
    )
    expect(facts.logos).toEqual([
      { from: 'header-svg', svg: LOGO_SVG.replace('Acme Parcel', 'Acme'), alt: 'Acme', rank: 1 },
    ])
  })

  it('ignores logos outside the header', () => {
    const facts = parseSiteFacts(doc('', `<main><a href="/">${LOGO_SVG}</a></main>`), BASE, [])
    expect(facts.logos).toEqual([])
  })

  it('reads JSON-LD Organization logos, including in @graph, and og:image last', () => {
    const graph = {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Acme' },
        {
          '@type': ['Organization'],
          name: 'Acme Parcel',
          logo: { '@type': 'ImageObject', url: '/brand/logo.png' },
        },
      ],
    }
    const brand = { '@type': 'Brand', logo: 'https://cdn.acme.test/mark.svg' }
    const facts = parseSiteFacts(
      doc(
        `<meta property="og:image" content="/share.jpg"><script type="application/ld+json">${JSON.stringify(graph)}</script><script type="application/ld+json">${JSON.stringify(brand)}</script><script type="application/ld+json">{broken</script>`
      ),
      BASE,
      []
    )
    expect(facts.logos).toEqual([
      { from: 'json-ld', url: 'https://acme.test/brand/logo.png', alt: 'Acme Parcel', rank: 3 },
      { from: 'json-ld', url: 'https://cdn.acme.test/mark.svg', alt: null, rank: 3 },
      { from: 'og-image', url: 'https://acme.test/share.jpg', alt: null, rank: 9 },
    ])
    expect(facts.shareImage).toBe('https://acme.test/share.jpg')
  })
})

describe('stylesheets and fonts', () => {
  const head = `
    <link rel="stylesheet" href="/css/main.css">
    <link rel="stylesheet" href="/css/print.css" media="print">
    <link rel="preload" href="/css/late.css" as="style">
    <link rel="alternate stylesheet" href="/css/alt.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Source+Serif+4:ital@0;1&display=swap">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:400,700|Lora">
    <link rel="stylesheet" href="https://fonts.bunny.net/css?family=nunito:400">
    <link rel="stylesheet" href="https://cdn.other.example/widget.css">
    <style>body{font-family:Inter}</style><style media="print">body{font-family:serif}</style>`

  it('lists stylesheet links in order without print, alternate or hosted font links', () => {
    expect(stylesheetLinks(doc(head), BASE)).toEqual([
      'https://acme.test/css/main.css',
      'https://acme.test/css/late.css',
      'https://cdn.other.example/widget.css',
    ])
  })

  it('names hosted font families', () => {
    expect(hostedFontFamilies(doc(head), BASE)).toEqual([
      'Inter',
      'Source Serif 4',
      'Roboto',
      'Lora',
      'nunito',
    ])
  })

  it('collects inline styles, skipping print ones', () => {
    expect(inlineStyles(doc(head))).toBe('body{font-family:Inter}')
  })

  it('reads fonts with the classes the h1 and body carry', () => {
    const html = doc(
      head,
      '<h1 class="font-display text-5xl">Parcels, delivered</h1>',
      'lang="en" class="__variable_d65c78"'
    )
    const facts = parseSiteFacts(html, BASE, [
      {
        url: 'https://acme.test/css/main.css',
        css: `
          .__variable_d65c78 { --font-sans: '__Inter_d65c78', '__Inter_Fallback_d65c78' }
          :root { --font-display: "Brandface-1bbd4a4c7a2fb472", Georgia, serif; --brand: #fe5e86 }
          html { font-family: var(--font-sans), system-ui, sans-serif }
          .font-display { font-family: var(--font-display) }
          @font-face { font-family: "Brandface-1bbd4a4c7a2fb472"; src: url(/f.woff2) }
        `,
      },
    ])
    expect(facts.fonts.heading).toMatchObject({ family: 'Brandface', generic: 'serif' })
    expect(facts.fonts.body).toMatchObject({ family: 'Inter', generic: 'sans' })
    expect(facts.fonts.faces).toEqual(['Brandface'])
    expect(facts.fonts.hosted).toContain('Source Serif 4')
    expect(facts.colours).toEqual([{ hex: '#fe5e86', from: '--brand', weight: 3 }])
    expect(facts.stylesheets).toEqual(['https://acme.test/css/main.css'])
  })
})
