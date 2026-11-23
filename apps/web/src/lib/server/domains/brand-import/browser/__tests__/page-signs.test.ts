// @vitest-environment happy-dom
/**
 * The signs the browser reader takes from a rendered page for telling the
 * site's own page from an error page, a bot check or a country picker.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  documentStatus,
  inlineSprites,
  logoImageSource,
  MAIN_DOCUMENT,
  schemeDarkLogo,
  spriteFiles,
  svgIconUrls,
} from '../read-helpers'
import { measurePageSigns } from '../page-signs'

const original = Element.prototype.getBoundingClientRect
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function () {
    const hidden = (this as Element).hasAttribute('data-hidden')
    return { width: hidden ? 0 : 100, height: hidden ? 0 : 20 } as DOMRect
  }
})
afterEach(() => {
  Element.prototype.getBoundingClientRect = original
  document.body.innerHTML = ''
})

describe('measurePageSigns', () => {
  it('reads the first visible heading, the words and the links with their words', () => {
    document.body.innerHTML = `<h1 data-hidden>Menu</h1><h1>Hello!  Choose a country.</h1>
      <a href="https://acme.example/ca"> Canada </a><a href="#main">Skip</a>
      <a href="mailto:hi@acme.example">Mail</a><a href="https://acme.example/us" aria-label="United States"></a>`
    const signs = measurePageSigns()
    expect(signs.heading).toBe('Hello! Choose a country.')
    expect(signs.links).toEqual([
      { href: 'https://acme.example/ca', text: 'Canada' },
      { href: 'https://acme.example/us', text: 'United States' },
    ])
    expect(signs.lead).toContain('Choose a country.')
    expect(signs.words).toBeGreaterThan(20)
  })

  it('reads an empty page as no words at all', () => {
    expect(measurePageSigns()).toEqual({ heading: '', lead: '', words: 0, links: [] })
  })
})

describe('logoImageSource', () => {
  const logo = { tag: 'IMG', src: 'https://acme.example/logo.png', w: 120, h: 30 }
  it('is the picture as the browser loaded it, an inline logo’s own markup, or a data address as it is', () => {
    expect(logoImageSource(logo, [{ url: logo.src, mime: 'image/png', data: 'AAAA' }])).toBe(
      'data:image/png;base64,AAAA'
    )
    const inline = logoImageSource(
      {
        tag: 'svg',
        src: null,
        w: 90,
        h: 30,
        svg: '<svg viewBox="0 0 9 3"><path d="M0 0h9"/></svg>',
        color: 'rgb(1, 2, 3)',
      },
      []
    )!
    expect(decodeURIComponent(inline)).toContain(
      '<svg color="rgb(1, 2, 3)" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 9 3">'
    )
    expect(logoImageSource({ ...logo, src: 'data:image/gif;base64,R0lG' }, [])).toBe(
      'data:image/gif;base64,R0lG'
    )
  })

  it('is nothing for a picture the browser did not hand over, one that is no image, or one too large', () => {
    expect(logoImageSource(logo, [])).toBeNull()
    expect(logoImageSource(logo, [{ url: logo.src, mime: 'text/html', data: 'AAAA' }])).toBeNull()
    expect(
      logoImageSource(logo, [{ url: logo.src, mime: 'image/png', data: 'A'.repeat(700_000) }])
    ).toBeNull()
  })
})

describe('schemeDarkLogo', () => {
  const img = (src: string) => ({ tag: 'IMG', src, w: 120, h: 30 })
  const drawn = (svg: string, color = 'rgb(0, 0, 0)') => ({
    tag: 'svg',
    src: null,
    w: 90,
    h: 30,
    svg,
    color,
  })
  it('is the logo shown to a dark system when it is another picture, or the same drawing in other colours', () => {
    expect(
      schemeDarkLogo(img('https://acme.example/a.svg'), img('https://acme.example/b.svg'))
    ).toEqual(img('https://acme.example/b.svg'))
    const white = drawn('<svg><path fill="rgb(255, 255, 255)"/></svg>')
    expect(schemeDarkLogo(drawn('<svg><path fill="rgb(0, 0, 0)"/></svg>'), white)).toBe(white)
    const inked = drawn('<svg><path fill="currentColor"/></svg>', 'rgb(255, 255, 255)')
    expect(schemeDarkLogo(drawn('<svg><path fill="currentColor"/></svg>'), inked)).toBe(inked)
  })

  it('is nothing when the page shows the same logo either way, or no logo', () => {
    expect(
      schemeDarkLogo(img('https://acme.example/a.svg'), img('https://acme.example/a.svg'))
    ).toBeNull()
    expect(schemeDarkLogo(drawn('<svg/>'), drawn('<svg/>'))).toBeNull()
    expect(schemeDarkLogo(img('https://acme.example/a.svg'), null)).toBeNull()
    // Another picture of another size is another element, not the logo's dark version.
    expect(
      schemeDarkLogo(img('https://acme.example/a.svg'), {
        ...img('https://acme.example/promo.png'),
        w: 300,
        h: 90,
      })
    ).toBeNull()
    expect(schemeDarkLogo(null, img('https://acme.example/a.svg'))).toBeNull()
  })
})

describe('documentStatus', () => {
  it('is the status of the document the visit ended on, else of the one asked for', () => {
    const documents = new Map([
      ['https://acme.example/', 301],
      ['https://www.acme.example/gb/', 403],
      ['https://ads.example/frame', 200],
    ])
    expect(
      documentStatus(documents, 'https://www.acme.example/gb/#top', 'https://acme.example/')
    ).toBe(403)
    expect(documentStatus(documents, 'https://www.acme.example/app', 'https://acme.example/')).toBe(
      301
    )
    expect(documentStatus(new Map(), 'https://acme.example/', 'https://acme.example/')).toBeNull()
    // Neither address was a document (a redirect, then a script moved the address on):
    // the latest answer of the page's own frame.
    expect(
      documentStatus(
        new Map([
          ['https://www.acme.example/?intl=1', 403],
          [MAIN_DOCUMENT, 403],
        ]),
        'https://www.acme.example/home',
        'https://acme.example/'
      )
    ).toBe(403)
  })
})

describe('a logo drawn from another file’s sprite', () => {
  const sprite =
    '<svg xmlns="http://www.w3.org/2000/svg"><symbol id="icon-menu" viewBox="0 0 8 8"><path d="M0 0h8"/></symbol><symbol id="site-logo" viewBox="0 0 134 20"><path fill="#f16436" d="M0 0h20v20z"/></symbol></svg>'
  const logo =
    '<svg class="desktop-logo" fill="rgb(0, 0, 0)"><use href="/images/sprite.svg#site-logo"></use></svg>'
  const page = 'https://acme.example/'

  it('names the files its symbols are kept in', () => {
    expect(spriteFiles(logo, page)).toEqual(['https://acme.example/images/sprite.svg'])
    expect(spriteFiles('<svg><use href="#mark"/></svg>', page)).toEqual([])
    expect(
      spriteFiles('<svg><use xlink:href="https://cdn.acme.example/s.svg#a"/></svg>', page)
    ).toEqual(['https://cdn.acme.example/s.svg'])
  })

  it('brings the symbol into the logo and points the use at it', () => {
    const drawn = inlineSprites(
      logo,
      new Map([['https://acme.example/images/sprite.svg', sprite]]),
      page
    )
    expect(drawn).toContain('<use href="#site-logo">')
    expect(drawn).toContain('<symbol id="site-logo" viewBox="0 0 134 20">')
    expect(drawn).not.toContain('icon-menu')
    expect(drawn).not.toContain('sprite.svg')
    expect(drawn.endsWith('</defs></svg>')).toBe(true)
  })

  it('leaves the logo as it was when the file or the symbol is missing', () => {
    expect(inlineSprites(logo, new Map(), page)).toBe(logo)
    expect(
      inlineSprites(
        logo,
        new Map([['https://acme.example/images/sprite.svg', '<svg></svg>']]),
        page
      )
    ).toBe(logo)
  })
})

describe('svgIconUrls', () => {
  it('lists the declared icons that are drawings, by type or by name', () => {
    expect(
      svgIconUrls([
        {
          url: 'https://acme.example/favicon.svg',
          size: null,
          type: 'image/svg+xml',
          from: 'icon',
        },
        { url: 'https://acme.example/mark.svg?v=2', size: null, type: null, from: 'icon' },
        { url: 'https://acme.example/touch.png', size: 180, type: null, from: 'apple-touch-icon' },
      ])
    ).toEqual(['https://acme.example/favicon.svg', 'https://acme.example/mark.svg?v=2'])
  })

  it('leaves out a drawing that is also the logo, which stays a drawing', () => {
    const icons = [
      { url: 'https://acme.example/mark.svg', size: null, type: null, from: 'icon' as const },
      { url: 'https://acme.example/favicon.svg', size: null, type: null, from: 'icon' as const },
    ]
    expect(svgIconUrls(icons, ['https://acme.example/mark.svg', null, undefined])).toEqual([
      'https://acme.example/favicon.svg',
    ])
  })
})
