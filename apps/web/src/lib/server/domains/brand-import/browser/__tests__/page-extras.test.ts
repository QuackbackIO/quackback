// @vitest-environment happy-dom
/**
 * The second pass over a rendered page: the name the site declares for
 * itself, and how its cards stand off the page, tallied box by box.
 * Layout is stubbed: each element sits where its data-rect says.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { measureBrandPage } from '../page-measure'
import { measurePageExtras } from '../page-extras'

const BASE =
  '* { opacity: 1; background-color: transparent; box-shadow: none; border-radius: 0px; border-width: 0px; color: rgb(17, 17, 17) } body { background-color: rgb(246, 245, 242); font-family: Lato, sans-serif }'

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
})
afterEach(() => {
  Element.prototype.getBoundingClientRect = original
  document.body.innerHTML = ''
})

describe('the name the site declares', () => {
  it('reads og:site_name', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta property="og:site_name" content=" Northwind ">'
    )
    expect(measurePageExtras().siteName).toBe('Northwind')
  })

  it('reads the organisation’s name from JSON-LD, in a graph too, when there is no og:site_name', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      `<script type="application/ld+json">{ not json</script><script type="application/ld+json">${JSON.stringify(
        {
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebPage', name: 'Home' },
            { '@type': ['Organization', 'Brand'], name: 'Northwind  Freight' },
          ],
        }
      )}</script>`
    )
    expect(measurePageExtras().siteName).toBe('Northwind Freight')
  })

  it('lists every name the page declares, the site’s first, then the organisation’s and the app’s', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      `<meta property="og:site_name" content="Love your freight">
       <meta name="application-name" content="Northwind">
       <meta name="apple-mobile-web-app-title" content="Northwind">
       <script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Northwind Freight Ltd' })}</script>`
    )
    const extras = measurePageExtras()
    expect(extras.siteName).toBe('Love your freight')
    expect(extras.names).toEqual(['Love your freight', 'Northwind Freight Ltd', 'Northwind'])
  })

  it('says what the logo the measurement took is labelled, without the word logo', () => {
    // The measurement finds the logo and leaves it for this pass.
    document.body.innerHTML =
      '<header><a href="/"><img src="https://acme.example/logo.png" alt="Acme Parcel logo"></a></header>'
    measureBrandPage()
    expect(measurePageExtras().logoLabel).toBe('Acme Parcel')
    document.body.innerHTML =
      '<header><a href="/" aria-label="Acme home"><svg><path d="M0 0h9"/></svg></a></header>'
    measureBrandPage()
    expect(measurePageExtras().logoLabel).toBe('Acme')
    document.body.innerHTML = '<p>No logo here</p>'
    measureBrandPage()
    expect(measurePageExtras().logoLabel).toBeNull()
  })

  it('says how the page’s words write the site’s own word', () => {
    document.title = 'Sign in'
    document.body.innerHTML =
      '<p>Northwind Express cards. Why Northwind Express? northwindexpress.example</p>'
    expect(measurePageExtras('northwindexpress').nameWritten).toBe('Northwind Express')
    expect(measurePageExtras('acme').nameWritten).toBeNull()
    expect(measurePageExtras().nameWritten).toBeNull()
  })

  it('reads none from a page that declares none', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      `<script type="application/ld+json">${JSON.stringify({ '@type': 'WebPage', name: 'Home' })}</script>`
    )
    expect(measurePageExtras().siteName).toBeNull()
  })
})

describe('the cards’ look, box by box', () => {
  const words = 'Plenty of words sit on this card. '.repeat(3)
  const chars = words.trim().length
  const card = (style: string, rect = '700,0,400,200', attrs = '') =>
    `<div ${attrs} data-rect="${rect}" style="background-color: rgb(255, 255, 255); border-radius: 12px; ${style}"><p>${words}</p></div>`
  const cards = (html: string) => {
    document.body.innerHTML = html
    return measurePageExtras().cards
  }
  const EDGE =
    'border-top-width: 1px; border-top-style: solid; border-top-color: rgb(210, 214, 220);'
  const DROP = 'box-shadow: rgba(0, 0, 0, 0.12) 0px 8px 24px 0px;'

  it('weighs each look by the words on its own cards, though they share a fill', () => {
    expect(cards(card(EDGE) + card(DROP) + card(''))).toEqual({
      border: chars,
      shadow: chars,
      flat: chars,
      flats: [{ bg: 'rgb(255, 255, 255)', chars }],
    })
  })

  it('reads a card with a real drop shadow as shadowed, whatever hairline it also has', () => {
    expect(cards(card(EDGE + DROP))).toMatchObject({ border: 0, shadow: chars, flat: 0 })
  })

  it('reads an edged card with only a whisper of shadow as bordered', () => {
    expect(cards(card(`${EDGE} box-shadow: rgba(0, 0, 0, 0.05) 0px 1px 2px 0px`))).toMatchObject({
      border: chars,
      shadow: 0,
      flat: 0,
    })
  })

  it('reads a hairline ring drawn as a shadow as an edge, and a see-through edge or shadow as none', () => {
    expect(cards(card('box-shadow: rgb(229, 229, 229) 0px 0px 0px 1px'))).toMatchObject({
      border: chars,
    })
    expect(
      cards(
        card(
          'border-top-width: 1px; border-top-style: solid; border-top-color: rgba(0, 0, 0, 0); box-shadow: rgba(0, 0, 0, 0) 0px 8px 24px 0px'
        )
      )
    ).toMatchObject({ border: 0, shadow: 0, flat: chars })
  })

  it('reads no card from a band, a chip, a square box or a box the page’s own colour', () => {
    const tally = cards(
      card('', '700,0,1400,200') +
        card('', '700,0,60,24') +
        `<div data-rect="700,0,400,200" style="background-color: rgb(255, 255, 255)"><p>${words}</p></div>` +
        `<div data-rect="700,0,400,200" style="background-color: rgb(246, 245, 242); border-radius: 12px"><p>${words}</p></div>`
    )
    expect(tally).toEqual({ border: 0, shadow: 0, flat: 0, flats: [] })
  })

  it('still reads the cards of a section that calls itself a banner', () => {
    expect(cards(`<section class="hero-banner">${card(DROP)}</section>`)).toMatchObject({
      shadow: chars,
    })
  })

  it('reads no card from a cookie banner, a dialog or a fixed layer', () => {
    const tally = cards(
      card(DROP, '700,0,400,200', 'id="cookie-banner"') +
        card(DROP, '700,0,400,200', 'role="dialog"') +
        `<div style="position: fixed">${card(DROP)}</div>`
    )
    expect(tally).toEqual({ border: 0, shadow: 0, flat: 0, flats: [] })
  })

  it('reads a card that is one link as a card', () => {
    expect(
      cards(
        `<a href="/x" data-rect="700,0,400,200" style="background-color: rgb(255, 255, 255); border-radius: 12px; ${DROP}"><span>${words}</span></a>`
      )
    ).toMatchObject({ border: 0, shadow: chars, flat: 0 })
  })

  it('reads nothing from words on a photo, in a button, or on a box too short for a card', () => {
    const tally = cards(
      `<div data-rect="700,0,400,200" style="background-color: rgb(20, 20, 20); background-image: url(hero.jpg); border-radius: 12px"><p>${words}</p></div>` +
        `<button data-rect="700,0,400,200" style="background-color: rgb(255, 255, 255); border-radius: 12px; ${DROP}">${words}</button>` +
        card(DROP, '700,0,400,56')
    )
    expect(tally).toEqual({ border: 0, shadow: 0, flat: 0, flats: [] })
  })
})
