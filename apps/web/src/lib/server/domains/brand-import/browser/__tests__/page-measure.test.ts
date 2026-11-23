// @vitest-environment happy-dom
/**
 * Measuring a rendered page: the body's colours and font as the fixtures were
 * measured (measure.mjs), every filled button with where it sits and whether
 * a cookie banner holds it, the font most words use, the largest heading's
 * font, the image that reads most as the logo, and whether the page is a bot
 * check's wall.
 * Layout is stubbed: each element sits where its data-rect says.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { measureBrandPage } from '../page-measure'
import { findPaintedLogo, markPageWrapper } from '../page-painted'

const BASE =
  '* { opacity: 1; background-color: transparent; box-shadow: none; border-radius: 0px; border-width: 0px; color: rgb(17, 17, 17) } body { background-color: rgb(255, 255, 255); font-family: Lato, sans-serif }'

const original = Element.prototype.getBoundingClientRect
beforeEach(() => {
  // top, left, width, height
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const [top, left, width, height] = (this.getAttribute('data-rect') ?? '10,0,600,60')
      .split(',')
      .map(Number) as [number, number, number, number]
    return {
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
    } as DOMRect
  }
  document.head.innerHTML = `<style>${BASE}</style>`
  document.title = 'Acme'
})
afterEach(() => {
  Element.prototype.getBoundingClientRect = original
  document.body.innerHTML = ''
  document.body.removeAttribute('style')
  document.documentElement.removeAttribute('style')
})

describe('measureBrandPage', () => {
  it('reads the body’s background, text colour and font, and the title', () => {
    document.body.innerHTML = '<p>Hello there</p>'
    const m = measureBrandPage()
    expect(m).toMatchObject({
      title: 'Acme',
      bg: 'rgb(255, 255, 255)',
      text: 'rgb(17, 17, 17)',
    })
    expect(m.bodyFont).toContain('Lato')
  })

  it('falls back to the root’s background when the body is transparent', () => {
    document.body.style.setProperty('background-color', 'transparent')
    document.documentElement.style.setProperty('background-color', 'rgb(8, 9, 10)')
    expect(measureBrandPage().bg).toBe('rgb(8, 9, 10)')
  })

  describe('a page whose body and root paint nothing', () => {
    const tall = (height: number) =>
      Object.defineProperty(document.documentElement, 'scrollHeight', {
        value: height,
        configurable: true,
      })
    beforeEach(() => {
      document.body.style.setProperty('background-color', 'transparent')
      tall(5000)
    })
    afterEach(() => {
      Reflect.deleteProperty(document.documentElement, 'scrollHeight')
      markPageWrapper()
    })
    const CLEAR = /^(?:transparent|rgba\(0, 0, 0, 0\))$/
    const measured = () => {
      markPageWrapper()
      return measureBrandPage()
    }
    const copy = '<p>Words of the page, enough of them to count for something here.</p>'

    it('takes the fill of the wrapper that runs the length of the page and holds its words', () => {
      document.body.innerHTML = `
        <div id="app" data-rect="0,0,1440,5000" style="background-color: rgb(16, 19, 23)">
          <header><a href="/pricing" data-rect="10,900,80,40">Pricing</a></header>
          <main>${copy}</main>
        </div>`
      const page = measured()
      expect(page.bg).toBe('rgb(16, 19, 23)')
      // Its words sit on the page, not on a box.
      expect(page.surfaces).toEqual([])
      expect(page.texts?.[0]?.color).toBe('rgb(17, 17, 17)')
    })

    it('does not take a hero band, a fixed layer, a column or a scrim for the page', () => {
      for (const box of [
        '<section data-rect="0,0,1440,900" style="background-color: rgb(0, 0, 0)">',
        '<div data-rect="0,0,1440,5000" style="position: fixed; background-color: rgb(0, 0, 0)">',
        '<div data-rect="0,0,300,5000" style="background-color: rgb(0, 0, 0)">',
        '<div data-rect="0,0,1440,5000" style="background-color: rgba(0, 0, 0, 0.5)">',
      ]) {
        document.body.innerHTML = `${box}${copy}</${box.slice(1, 4) === 'sec' ? 'section' : 'div'}>`
        expect(measured().bg, box).toMatch(CLEAR)
      }
    })

    it('does not take a page-long box that holds little of the page’s words', () => {
      document.body.innerHTML = `
        <div data-rect="0,0,1440,5000" style="background-color: rgb(0, 0, 0)"><p>Side.</p></div>
        <main>${copy.repeat(4)}</main>`
      expect(measured().bg).toMatch(CLEAR)
    })

    it('leaves a page that paints its own body alone', () => {
      document.body.style.setProperty('background-color', 'rgb(255, 255, 255)')
      document.body.innerHTML = `<div data-rect="0,0,1440,5000" style="background-color: rgb(16, 19, 23)">${copy}</div>`
      expect(measured().bg).toBe('rgb(255, 255, 255)')
    })
  })

  it('reads the theme-color meta', () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#123456">')
    expect(measureBrandPage().themeColor).toBe('#123456')
    document.head.querySelector('meta')?.remove()
  })

  it('takes filled buttons in page order, leaving out consent controls and page-coloured ones', () => {
    document.body.innerHTML = `
      <div id="onetrust-banner"><button data-rect="10,0,120,40" style="background-color: rgb(0, 0, 0)">Accept all</button></div>
      <a data-rect="20,0,120,40" style="background-color: rgb(255, 255, 255)">Plain</a>
      <a data-rect="30,0,120,40" style="background-color: rgb(83, 58, 253); color: rgb(255, 255, 255); border-radius: 4px">Contact sales</a>
      <a data-rect="40,0,120,48" style="background-color: rgb(0, 117, 222); border-radius: 50%">Get started</a>`
    const { buttons } = measureBrandPage()
    expect(buttons.map((b) => b.bg)).toEqual(['rgb(83, 58, 253)', 'rgb(0, 117, 222)'])
    expect(buttons[0]).toMatchObject({ fg: 'rgb(255, 255, 255)', radius: '4px', h: 40 })
    expect(buttons[1]?.radius).toBe('50%')
  })

  it('leaves out hidden, tiny, wordless and far-down buttons', () => {
    document.body.innerHTML = `
      <a data-rect="10,0,120,40" style="background-color: rgb(1, 2, 3); visibility: hidden">Hidden</a>
      <a data-rect="10,0,10,10" style="background-color: rgb(1, 2, 3)">Tiny</a>
      <a data-rect="10,0,120,40" style="background-color: rgb(1, 2, 3)">x</a>
      <a data-rect="2000,0,120,40" style="background-color: rgb(1, 2, 3)">Far down</a>`
    expect(measureBrandPage().buttons).toEqual([])
  })

  it('lists every filled button with its words, size and place, for the reader to choose from', () => {
    document.body.innerHTML = `
      <header><a data-rect="10,0,90,32" style="background-color: rgb(0, 0, 0); color: rgb(255, 255, 255)">Sign up</a></header>
      <a data-rect="300,0,200,48" style="background-color: rgb(8, 135, 43); color: rgb(255, 255, 255)">Get started for free</a>
      <a data-rect="320,0,200,48" style="background-color: rgba(255, 255, 255, 0); color: rgb(0, 0, 0)">Ghost</a>`
    const { candidates } = measureBrandPage()
    expect(candidates).toEqual([
      expect.objectContaining({
        bg: 'rgb(0, 0, 0)',
        text: 'Sign up',
        header: true,
        overlay: false,
        w: 90,
        h: 32,
        top: 10,
      }),
      expect.objectContaining({
        bg: 'rgb(8, 135, 43)',
        text: 'Get started for free',
        header: false,
        w: 200,
      }),
    ])
  })

  it('reads a button’s fill from the box inside it, or its gradient, when the link itself is clear', () => {
    document.body.innerHTML = `
      <a data-rect="300,0,200,50"><span data-rect="300,0,200,50" style="background-color: rgb(88, 204, 2)">Get started</span></a>
      <a data-rect="400,0,200,50" style="background-image: linear-gradient(90deg, rgb(252, 109, 38), rgb(119, 89, 194))">Try for free</a>`
    const fills = measureBrandPage().candidates?.map((c) => c.bg)
    expect(fills).toEqual(['rgb(88, 204, 2)', 'rgb(252, 109, 38)'])
  })

  it('reads the words’ colour from the box that gives the fill', () => {
    document.body.innerHTML = `<a data-rect="300,0,200,50" style="color: rgb(255, 255, 255)"><span data-rect="300,0,200,50" style="background-color: rgb(255, 255, 255); color: rgb(0, 0, 0)">Open app</span></a>`
    expect(measureBrandPage().candidates?.[0]).toMatchObject({
      bg: 'rgb(255, 255, 255)',
      fg: 'rgb(0, 0, 0)',
    })
  })

  it('lists only filled buttons, so a long menu of plain links cannot crowd out the call to action', () => {
    const links = Array.from(
      { length: 60 },
      (_, i) => `<a data-rect="${20 + i},0,120,40">Menu item ${i}</a>`
    ).join('')
    document.body.innerHTML = `${links}<a data-rect="600,0,200,48" style="background-color: rgb(159, 232, 112)">Open an account</a>`
    expect(measureBrandPage().candidates?.map((c) => c.text)).toEqual(['Open an account'])
  })

  it('marks a button in a cookie dialog as overlay even when nothing names it consent', () => {
    document.body.innerHTML = `
      <div class="c1q2" style="position: fixed"><div class="x9"><p>We use cookies to improve your stay.</p>
        <button class="b7" data-rect="600,0,120,40" style="background-color: rgb(34, 34, 34)">Accept all</button></div></div>
      <a data-rect="300,0,200,48" style="background-color: rgb(255, 56, 92)">Search stays</a>`
    const m = measureBrandPage()
    expect(m.candidates?.find((c) => c.text === 'Accept all')?.overlay).toBe(true)
    expect(m.buttons.map((b) => b.bg)).toEqual(['rgb(255, 56, 92)'])
  })

  it('leaves see-through fills out of the filled buttons', () => {
    document.body.innerHTML = `
      <a data-rect="10,0,120,40" style="background-color: rgba(255, 255, 255, 0)">Log in</a>
      <a data-rect="15,0,120,40" style="background-color: oklch(0.6 0.2 30 / 0)">Ghost</a>
      <a data-rect="20,0,120,40" style="background-color: rgb(2, 126, 111)">Sign up</a>`
    expect(measureBrandPage().buttons.map((b) => b.bg)).toEqual(['rgb(2, 126, 111)'])
  })

  it('reads the font and colour most of the words are set in, not only the body’s', () => {
    document.body.style.setProperty('font-family', '"Times New Roman"')
    document.body.innerHTML = `
      <div style="font-family: 'Brand Sans', sans-serif">
        <p style="color: rgb(40, 40, 60)">Plenty of words are set in the brand face across this whole page.</p>
        <p style="color: rgb(40, 40, 60)">And more of them, so this face clearly carries the reading.</p>
      </div>
      <small>Tiny note</small>`
    const m = measureBrandPage()
    expect(m.textFont).toContain('Brand Sans')
    expect(m.textColor).toBe('rgb(40, 40, 60)')
  })

  it('does not count a cookie banner’s words toward the page’s font', () => {
    document.body.innerHTML = `
      <p style="font-family: Brand">Short brand line here.</p>
      <div id="cookie-banner" style="font-family: Banner"><p>${'We use cookies and similar technologies. '.repeat(10)}</p></div>`
    expect(measureBrandPage().textFont).toContain('Brand')
  })

  it('checks consent markup with the reader’s one consent rule', async () => {
    const { CONSENT_MARKUP } = await import('../../site/consent')
    expect(measureBrandPage.toString()).toContain(CONSENT_MARKUP.source)
  })

  describe('the colours the words sit on', () => {
    it('weighs each surface by the words on it, not by its size', () => {
      document.body.innerHTML = `
        <section data-rect="0,0,1440,600" style="background-color: rgb(0, 97, 254)"><h1>Big hero</h1></section>
        <div data-rect="700,0,400,200" style="background-color: rgb(246, 249, 252); border-radius: 12px">
          <p>${'Plenty of words sit on this card, more than on the hero. '.repeat(4)}</p>
        </div>`
      const surfaces = measureBrandPage().surfaces ?? []
      expect(surfaces[0]).toMatchObject({ bg: 'rgb(246, 249, 252)', rounded: true })
      expect(surfaces[0]!.chars).toBeGreaterThan(surfaces[1]!.chars)
    })

    it('reads no surface from a photo or gradient, nor from a cookie banner', () => {
      document.body.innerHTML = `
        <div data-rect="0,0,600,400" style="background-color: rgb(20, 20, 20); background-image: url(hero.jpg)"><p>On a photo</p></div>
        <div id="cookie-banner" data-rect="700,0,600,100" style="background-color: rgb(30, 30, 30)"><p>We use cookies</p></div>`
      expect(measureBrandPage().surfaces).toEqual([])
    })

    it('lists the text colours by the words they carry, and the border colours by use', () => {
      document.body.innerHTML = `
        <p style="color: rgb(10, 37, 64)">${'The main words of the page. '.repeat(5)}</p>
        <p style="color: rgb(66, 84, 102)">Quieter words.</p>
        <div data-rect="10,0,300,100" style="border: 1px solid rgb(227, 232, 238)"><span>card</span></div>
        <div data-rect="20,0,300,100" style="border: 1px solid rgb(227, 232, 238)"><span>card</span></div>`
      const m = measureBrandPage()
      expect(m.texts?.map((t) => t.color).slice(0, 2)).toEqual([
        'rgb(10, 37, 64)',
        'rgb(66, 84, 102)',
      ])
      expect(m.borders?.[0]).toMatchObject({ color: 'rgb(227, 232, 238)', count: 2 })
    })
  })

  it('takes the headline font from the largest visible h1 or h2', () => {
    document.body.innerHTML = `
      <h2 style="font-size: 30px; font-family: Small">Small</h2>
      <h1 style="font-size: 64px; font-family: 'Big Display', serif">Big</h1>`
    expect(measureBrandPage().h1?.font).toContain('Big Display')
  })

  it('takes the first visible image or SVG in the header as the logo', () => {
    document.body.innerHTML = `<header>
      <img data-rect="10,0,4,4" src="https://acme.example/pixel.png">
      <img data-rect="10,0,120,30" src="https://acme.example/logo.png">
    </header>`
    expect(measureBrandPage().logo).toMatchObject({
      tag: 'IMG',
      src: 'https://acme.example/logo.png',
      w: 120,
      h: 30,
    })
  })

  it('sends an inline SVG logo’s markup with its colour, and the symbols it uses', () => {
    document.body.innerHTML = `
      <svg style="display: none"><symbol id="mark" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></symbol></svg>
      <nav><svg data-rect="10,0,90,30" viewBox="0 0 90 30" style="color: rgb(10, 37, 64)"><use href="#mark"/></svg></nav>`
    const logo = measureBrandPage().logo
    expect(logo).toMatchObject({ tag: 'svg', w: 90, h: 30, color: 'rgb(10, 37, 64)' })
    expect(logo?.svg).toContain('<use')
    expect(logo?.svg).toContain('id="mark"')
  })

  it('writes the size an inline logo is drawn at into its markup when it has none of its own', () => {
    document.body.innerHTML = `<header>
      <a href="/"><svg data-rect="22,20,134,20" class="desktop-logo"><use href="/images/sprite.svg#site-logo"></use></svg></a>
    </header>`
    expect(measureBrandPage().logo?.svg).toMatch(/^<svg [^>]*width="134" height="20"/)
    // One with a viewBox, or a size, keeps its own.
    document.body.innerHTML = `<header>
      <a href="/"><svg data-rect="22,20,134,20" viewBox="0 0 67 10"><path d="M0 0h9"/></svg></a>
    </header>`
    expect(measureBrandPage().logo?.svg).not.toContain('width=')
  })

  it('writes the colours a logo’s CSS variables resolve to into its markup', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<style>path.ink { fill: rgb(6, 27, 49) }</style>'
    )
    document.body.innerHTML = `<header><svg data-rect="10,0,60,25" viewBox="0 0 60 25">
      <path class="ink" fill="var(--brand-ink)" d="M0 0h60v25z"/>
      <path fill="#635bff" d="M0 0h10v10z"/>
    </svg></header>`
    const svg = measureBrandPage().logo?.svg ?? ''
    expect(svg).not.toContain('var(')
    expect(svg).toContain('fill="rgb(6, 27, 49)"')
    expect(svg).toContain('fill="#635bff"')
  })

  it('leaves a shape kept in defs to the paint of whatever uses it', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<style>.mark use { fill: rgb(255, 255, 255) }</style>'
    )
    document.body.innerHTML = `<header data-rect="0,0,1440,64"><a href="/"><svg class="mark" data-rect="10,0,90,30">
      <defs><path id="word" d="M0 0h9"/></defs><use href="#word"/></svg></a></header>`
    const svg = measureBrandPage().logo?.svg ?? ''
    // The use carries the page's paint; the path in defs is not given a black of its own.
    expect(svg).toMatch(/<use[^>]*fill="rgb\(255, 255, 255\)"/)
    expect(svg).not.toMatch(/<path[^>]*fill=/)
  })

  it('writes paints a stylesheet gives a logo into its markup, so it draws on its own', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<style>.word path { fill: rgb(1, 2, 3) }</style>'
    )
    document.body.innerHTML = `<header><svg class="word" data-rect="10,0,200,30" viewBox="0 0 200 30" fill="none">
      <path d="M0 0h60v25z"/>
    </svg></header>`
    expect(measureBrandPage().logo?.svg).toContain('fill="rgb(1, 2, 3)"')
  })

  it('says when the page is a bot check’s wall', () => {
    document.body.innerHTML =
      '<iframe data-rect="10,0,400,400" src="https://geo.captcha-delivery.com/captcha/?initialCid=x"></iframe>'
    expect(measureBrandPage().wall).toBe(true)
    document.body.innerHTML = '<h1>Welcome to Acme</h1><p>We make parcels simple.</p>'
    expect(measureBrandPage().wall).toBe(false)
  })

  it('calls a short access-denied page a wall, but not a full page about security checks', () => {
    document.title = 'Access Denied'
    document.body.innerHTML =
      '<h1>Access Denied</h1><p>You don’t have permission to access this server.</p>'
    expect(measureBrandPage().wall).toBe(true)
    document.title = 'Your security checklist'
    document.body.innerHTML = `<h1>Your security checklist</h1><p>${'Everything a team needs to stay safe online. '.repeat(60)}</p>`
    expect(measureBrandPage().wall).toBe(false)
  })

  it('does not call a full page a wall for the invisible captcha its forms carry', () => {
    document.body.innerHTML = `<h1>Welcome to Acme</h1><p>${'We make parcels simple, fast and kind to the planet. '.repeat(60)}</p>
      <iframe data-rect="10,0,1,1" src="https://www.google.com/recaptcha/api2/anchor?k=x"></iframe>`
    expect(measureBrandPage().wall).toBe(false)
  })

  it('lists the icons the page declares, with their sizes, as absolute addresses', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<link rel="apple-touch-icon" sizes="180x180" href="/touch.png"><link rel="icon" href="/favicon.svg" type="image/svg+xml">'
    )
    expect(measureBrandPage().icons).toEqual([
      { url: `${location.origin}/touch.png`, size: 180, type: null, from: 'apple-touch-icon' },
      { url: `${location.origin}/favicon.svg`, size: null, type: 'image/svg+xml', from: 'icon' },
    ])
    document.head.querySelectorAll('link').forEach((link) => link.remove())
  })

  it('reads the page’s text colour from words on the page, not a hero band’s or a photo’s', () => {
    document.body.innerHTML = `
      <section data-rect="0,0,1440,600" style="background-color: rgb(20, 20, 60)">
        <h1 style="color: rgb(255, 255, 255)">${'A very long hero headline in white on the dark band. '.repeat(6)}</h1>
      </section>
      <div data-rect="0,0,1440,500" style="background-image: url(photo.jpg)"><p style="color: rgb(255, 255, 255)">${'Words over a photo. '.repeat(6)}</p></div>
      <p style="color: rgb(22, 51, 0)">Body copy sits on the page itself.</p>`
    expect(measureBrandPage().textColor).toBe('rgb(22, 51, 0)')
  })

  it('reads the page’s text colour from its words, not its links', () => {
    document.body.innerHTML = `
      <p style="color: rgb(32, 33, 36)">Search the world’s information.</p>
      <div>${'<a style="color: rgb(104, 29, 168)">Language</a> '.repeat(20)}</div>`
    expect(measureBrandPage().textColor).toBe('rgb(32, 33, 36)')
  })

  it('reads the header bar’s colour behind the logo, and its links’ colour', () => {
    document.body.innerHTML = `
      <div data-rect="0,0,1440,40" style="background-color: rgb(255, 255, 255)"><p>Cookies on this site</p></div>
      <header data-rect="40,0,1440,64" style="background-color: rgb(0, 94, 184)">
        <div data-rect="40,0,1200,64"><a href="/"><img data-rect="52,16,120,40" src="https://acme.example/logo.svg" alt="Acme"></a></div>
        <nav>${'<a data-rect="60,400,80,20" style="color: rgb(255, 255, 255)">Services</a>'.repeat(4)}</nav>
      </header>
      <main><p>Body copy.</p></main>`
    expect(measureBrandPage().header).toEqual({ bg: 'rgb(0, 94, 184)', text: 'rgb(255, 255, 255)' })
  })

  it('reads a gradient bar by its first colour, past a small filled link round the logo', () => {
    document.body.innerHTML = `
      <header data-rect="0,0,1440,56" style="background-image: linear-gradient(to right, rgb(7, 53, 144), rgb(7, 53, 144))">
        <a href="/" data-rect="8,16,140,40" style="background-color: rgb(29, 112, 184)"><img data-rect="8,16,120,40" src="https://acme.example/logo.svg"></a>
      </header>`
    expect(measureBrandPage().header).toEqual({ bg: 'rgb(7, 53, 144)' })
  })

  it('has no header colour when the header is see-through, a tall hero, or a photo', () => {
    document.body.innerHTML = `<header data-rect="0,0,1440,64"><a href="/"><img data-rect="16,16,120,40" src="https://acme.example/logo.svg"></a></header>`
    expect(measureBrandPage().header).toBeNull()
    document.body.innerHTML = `<section data-rect="0,0,1440,700" style="background-color: rgb(159, 232, 112)">
      <header data-rect="0,0,1440,64"><a href="/"><img data-rect="16,16,120,40" src="https://acme.example/logo.svg"></a></header></section>`
    expect(measureBrandPage().header).toBeNull()
    document.body.innerHTML = `<header data-rect="0,0,1440,64" style="background-color: rgb(20, 20, 20); background-image: url(photo.jpg)">
      <a href="/"><img data-rect="16,16,120,40" src="https://acme.example/logo.svg"></a></header>`
    expect(measureBrandPage().header).toBeNull()
  })

  it('looks past a header or nav with no image in it for the logo', () => {
    document.body.innerHTML = `<nav><a href="/en">English</a></nav>
      <main><img data-rect="40,0,200,183" class="central-featured-logo" src="https://acme.example/globe.png" alt="Acme"></main>`
    expect(measureBrandPage().logo).toMatchObject({ src: 'https://acme.example/globe.png' })
  })

  it('has no logo without a header or nav, unless one is named or links home', () => {
    document.body.innerHTML = '<img data-rect="10,0,120,30" src="https://acme.example/photo.png">'
    expect(measureBrandPage().logo).toBeNull()
    document.body.innerHTML = `<main>
      <img data-rect="10,0,600,300" src="https://acme.example/hero.png" alt="People smiling">
      <a href="/"><img data-rect="40,0,200,183" src="https://acme.example/Wiki-logo.png" alt="Acme"></a>
    </main>`
    expect(measureBrandPage().logo).toMatchObject({ src: 'https://acme.example/Wiki-logo.png' })
    document.body.innerHTML =
      '<div class="central-featured-logo"><img data-rect="40,0,200,183" src="https://acme.example/globe.png"></div>'
    expect(measureBrandPage().logo).toMatchObject({ src: 'https://acme.example/globe.png' })
  })

  describe('ranking what could be the logo', () => {
    const PHOTO =
      'https://img.acme.example/media/640_96_1668_1668/master/1668.jpg?width=98&crop=1%3A1'
    /** A news site's header: a sign-in icon, cropped photos, then the wordmark on its bar. */
    const newsHeader = (top: number) => `
      <header data-rect="${top},0,1440,363">
        <a href="https://profile.acme.example/signin"><svg data-rect="${top + 23},1115,18,18" viewBox="0 0 18 18"><path d="M0 0h18v18z"/></svg></a>
        <img data-rect="${top + 89},442,98,98" src="${PHOTO}" alt="A man at an event">
        <img data-rect="${top + 89},762,98,98" src="https://img.acme.example/uploads/columnist.png?width=98&crop=1%3A1" alt="Jo Bloggs">
        <svg data-rect="${top + 104},900,19,12" viewBox="0 0 19 12"><title>double quotation mark</title><path d="M0 0h19v12z"/></svg>
        <nav data-rect="${top + 205},0,1440,158" style="background-color: rgb(5, 41, 98)">
          <a href="/"><span>Acme - Back to home</span><svg data-rect="${top + 213},899,291,97" viewBox="0 0 300 100" aria-hidden="true"><path d="M0 0h300v100z"/></svg></a>
          ${'<a href="/news" data-rect="300,250,108,40" style="color: rgb(255, 255, 255)">News</a>'.repeat(3)}
        </nav>
      </header>`

    it('takes the wordmark that links home over the photos before it in the header', () => {
      document.body.innerHTML = newsHeader(0)
      const page = measureBrandPage()
      expect(page.logo).toMatchObject({ tag: 'svg', w: 291, h: 97 })
      expect(page.header).toEqual({ bg: 'rgb(5, 41, 98)', text: 'rgb(255, 255, 255)' })
    })

    it('still reads the bar of a header an advert slot pushes down the first screen', () => {
      document.body.innerHTML = `<div data-rect="0,0,1440,295"></div>${newsHeader(295)}`
      const page = measureBrandPage()
      expect(page.logo).toMatchObject({ tag: 'svg', w: 291, h: 97 })
      expect(page.header?.bg).toBe('rgb(5, 41, 98)')
    })

    it('takes the logo that links home over a shop’s promotions, even one named a logo', () => {
      document.body.innerHTML = `
        <header data-rect="0,0,1440,60" style="background-color: rgb(19, 25, 33)">
          <a href="/shop/deals"><img data-rect="10,1100,120,40" src="https://m.acme.example/images/deal._SX120_.jpg" alt="Acme deals"></a>
          <a href="/" aria-label="Acme"><img data-rect="10,12,110,34" src="https://m.acme.example/images/nav.png" alt=""></a>
        </header>
        <main>
          <a href="/b/?node=887"><img data-rect="107,567,267,428" src="https://m.acme.example/images/I/61.jpg?aicid=homepage-single-creative-card" alt="Save 15% on Resale"></a>
          <a href="/b/?node=887"><img data-rect="221,579,224,28" class="card_style_logo" src="https://m.acme.example/images/I/11.png?aicid=homepage-card-logo" alt="Acme Resale"></a>
        </main>`
      const page = measureBrandPage()
      expect(page.logo).toMatchObject({ src: 'https://m.acme.example/images/nav.png' })
      expect(page.header?.bg).toBe('rgb(19, 25, 33)')
    })

    it('has no logo when the only named one belongs to a promotion that links elsewhere', () => {
      document.body.innerHTML = `
        <header data-rect="0,0,1440,60"><a href="/" class="nav-logo-link" data-rect="5,12,150,50"><span class="nav-sprite"></span></a></header>
        <main>
          <a href="/b/?node=887"><img data-rect="107,567,267,428" src="https://m.acme.example/images/I/61.jpg?aicid=homepage-single-creative-card" alt="Save 15% on Resale"></a>
          <a href="/b/?node=887"><img data-rect="221,579,224,28" class="card_style_logo" src="https://m.acme.example/images/I/11.png?aicid=homepage-card-logo" alt="Acme Resale"></a>
        </main>`
      expect(measureBrandPage().logo).toBeNull()
    })

    it('reads the bar from the home link when the logo on it is a background picture', () => {
      document.body.innerHTML = `
        <header data-rect="0,0,1440,99">
          <div data-rect="0,0,1440,60" style="background-color: rgb(19, 25, 33)">
            <a href="/ref=nav_logo" class="nav-logo-link" aria-label="Acme" data-rect="5,12,150,50"><span class="nav-sprite"></span></a>
            ${'<a href="/orders" data-rect="10,900,80,40" style="color: rgb(255, 255, 255)">Orders</a>'.repeat(2)}
          </div>
        </header>
        <main><p>Body copy.</p></main>`
      const page = measureBrandPage()
      expect(page.logo).toBeNull()
      expect(page.header).toEqual({ bg: 'rgb(19, 25, 33)', text: 'rgb(255, 255, 255)' })
    })

    it('takes a logo painted on the home link as a picture or a mask, when it is a drawing', () => {
      for (const paint of ['background-image', 'mask-image']) {
        document.body.innerHTML = `
          <header data-rect="0,0,1440,99">
            <a href="/" class="identity-logo" data-rect="27,135,191,50" style="${paint}: url('/theme/logo.svg'); text-indent: -1000px">Acme</a>
            <a href="/about" data-rect="45,679,103,18">About</a>
          </header>
          <main><p>Body copy.</p></main>`
        expect(measureBrandPage().logo).toBeNull()
        expect(findPaintedLogo(), paint).toEqual({
          tag: 'IMG',
          src: `${location.origin}/theme/logo.svg`,
          w: 191,
          h: 50,
        })
      }
    })

    it('takes no sprite sheet, photo or gradient painted on the home link for the logo', () => {
      for (const image of [
        "url('/sprites/nav.png')",
        "url('/hero.jpg')",
        'linear-gradient(rgb(0, 0, 0), rgb(9, 9, 9))',
        "url('/a.svg'), url('/b.svg')",
      ]) {
        document.body.innerHTML = `
          <header data-rect="0,0,1440,99">
            <a href="/" class="logo" data-rect="27,135,191,50" style="background-image: ${image}">Acme</a>
          </header>`
        expect(measureBrandPage().logo, image).toBeNull()
        expect(findPaintedLogo(), image).toBeNull()
      }
    })

    it('passes over icons in buttons and small unmarked icons for the logo after them', () => {
      document.body.innerHTML = `<header>
        <button><svg data-rect="20,32,24,24" class="menu-icon" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg></button>
        <div role="button"><img data-rect="20,60,24,24" src="https://acme.example/flags/gb.png" alt=""></div>
        <svg data-rect="22,90,16,16" viewBox="0 0 16 16"><path d="M0 0h16v16z"/></svg>
        <a href="${location.origin}"><svg data-rect="20,120,46,22" class="mark" viewBox="0 0 46 22"><path d="M0 0h46v22z"/></svg></a>
        <button><svg data-rect="20,1192,24,24" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg></button>
      </header>`
      expect(measureBrandPage().logo).toMatchObject({ tag: 'svg', w: 46, h: 22 })
    })

    it('takes a slim mark that links home over a wider menu icon beside it', () => {
      document.body.innerHTML = `<nav>
        <a href="/" aria-label="Acme"><svg data-rect="0,230,14,44" viewBox="0 0 14 44"><path d="M0 0h14v44z"/></svg></a>
        <a href="/shop" aria-label="Store"><svg data-rect="0,282,30,44" viewBox="0 0 30 44"><path d="M0 0h30v44z"/></svg></a>
      </nav>`
      expect(measureBrandPage().logo).toMatchObject({ tag: 'svg', w: 14, h: 44 })
    })

    it('prefers the image marked in more ways, and a drawing over a picture', () => {
      document.body.innerHTML = `<header>
        <a href="/"><svg data-rect="60,180,20,20" viewBox="0 0 20 20"><path d="M0 0h20v20z"/></svg></a>
        <a href="/" aria-label="Acme"><svg data-rect="20,180,144,24" viewBox="0 0 144 24"><path d="M0 0h144v24z"/></svg></a>
      </header>`
      expect(measureBrandPage().logo).toMatchObject({ w: 144, h: 24 })
      document.body.innerHTML = `<header>
        <img data-rect="10,0,120,30" src="https://acme.example/header.png">
        <img data-rect="10,200,120,30" src="https://acme.example/header.svg">
      </header>`
      expect(measureBrandPage().logo).toMatchObject({ src: 'https://acme.example/header.svg' })
    })

    it('knows the home page of a language or country, and the page it is on, as home', () => {
      for (const href of [
        '/gb/en/',
        '/en-gb',
        `${location.origin}/index.en-gb.html`,
        '/#top',
        '',
        '/home/',
        '/home',
      ]) {
        document.body.innerHTML = `<header>
          <a href="/account"><img data-rect="10,0,120,30" class="logo" src="https://acme.example/partner.png"></a>
          <a href="${href}"><img data-rect="10,200,120,30" src="https://acme.example/us.png"></a>
        </header>`
        expect(measureBrandPage().logo, href).toMatchObject({ src: 'https://acme.example/us.png' })
      }
    })

    it('takes no unmarked photo or icon, nor a skip link’s, for want of a better one', () => {
      document.body.innerHTML = `<header>
        <img data-rect="10,0,98,98" src="${PHOTO}" alt="A man at an event">
        <a href="/account"><svg data-rect="10,200,24,24" viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg></a>
        <img data-rect="10,300,1440,580" src="https://acme.example/hero.png" alt="Acme">
        <a href="#content" aria-label="Acme"><svg data-rect="10,400,16,16" viewBox="0 0 16 16"><path d="M0 0h16v16z"/></svg></a>
      </header>`
      expect(measureBrandPage().logo).toBeNull()
    })

    it('takes a photo file when it is named the logo', () => {
      document.body.innerHTML = `<main>
        <img data-rect="0,163,100,112" class="logo" src="https://acme.example/img/Acme_Logo_Small.jpg" alt="Acme Panda Logo">
        <img data-rect="278,757,20,32" src="https://acme.example/img/pin.png" alt="">
      </main>`
      expect(measureBrandPage().logo).toMatchObject({ w: 100, h: 112 })
    })

    it('takes a link at its word when it says it goes home', () => {
      for (const link of [
        'href="/homepage" aria-label="Navigate to home"',
        'href="/product" aria-label="Acme – Home"',
        'href="/welcome" title="Acme homepage"',
      ]) {
        document.body.innerHTML = `<div>
          <a href="/pricing" aria-label="Smart Home & Garden"><svg data-rect="14,480,60,30" class="brand" viewBox="0 0 60 30"><path d="M0 0h60v30z"/></svg></a>
          <a ${link} class="logoLink"><svg data-rect="59,22,33,34" viewBox="0 0 33 34"><path d="M0 0h33v34z"/></svg></a>
        </div>`
        expect(measureBrandPage().logo, link).toMatchObject({ tag: 'svg', w: 33, h: 34 })
      }
    })

    it('does not take another site’s link home for this site’s', () => {
      document.body.innerHTML = `<main>
        <a href="https://sister.example/" aria-label="Sister homepage"><img data-rect="10,0,120,30" class="logo" src="https://sister.example/s.png"></a>
      </main>`
      expect(measureBrandPage().logo).toBeNull()
    })

    it('takes a long wordmark when it is marked, but no unmarked banner', () => {
      document.body.innerHTML = `<header>
        <img data-rect="10,0,520,60" src="https://acme.example/strip.png">
        <a href="/"><img data-rect="80,30,520,66" class="logo" src="https://acme.example/long.png"></a>
      </header>`
      expect(measureBrandPage().logo).toMatchObject({ src: 'https://acme.example/long.png' })
      document.body.innerHTML = `<header><img data-rect="10,0,520,60" src="https://acme.example/strip.png"></header>`
      expect(measureBrandPage().logo).toBeNull()
    })

    it('falls back on the header’s first plain image, wherever it links', () => {
      document.body.innerHTML = `<header>
        <a href="/dashboard"><img data-rect="10,0,120,30" src="https://acme.example/a.png"></a>
        <a href="/pricing"><img data-rect="10,200,120,30" src="https://acme.example/b.png"></a>
      </header>`
      expect(measureBrandPage().logo).toMatchObject({ src: 'https://acme.example/a.png' })
    })

    it('takes a logo named for the site, by the page’s title or its address', () => {
      document.body.innerHTML = `<main>
        <img data-rect="10,0,300,150" src="https://acme.example/a.png" alt="Parcels on a belt">
        <img data-rect="200,600,171,138" src="https://acme.example/b.png" alt="Acme">
      </main>`
      expect(measureBrandPage().logo).toMatchObject({ src: 'https://acme.example/b.png' })
    })
  })
})
