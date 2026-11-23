// @vitest-environment happy-dom
/**
 * A header that is a tall band: the logo and the menu sit at the top of a
 * plain block of colour that also holds the page's opening words. It is the
 * site's header colour only when it is plainly that: one solid colour, no
 * picture, gradient or media over it, holding both the logo and the menu.
 * A false header is worse than a missing one, so anything else reads as none.
 * Layout is stubbed: each element sits where its data-rect says.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { measureBrandPage } from '../page-measure'
import { measureHeaderBand } from '../page-header-band'

const BASE =
  '* { opacity: 1; background-color: transparent; background-image: none; color: rgb(17, 17, 17) } body { background-color: rgb(255, 255, 255) }'
const original = Element.prototype.getBoundingClientRect
beforeEach(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const [top, left, width, height] = (this.getAttribute('data-rect') ?? '10,0,600,60')
      .split(',')
      .map(Number) as [number, number, number, number]
    return { top, left, width, height, right: left + width, bottom: top + height } as DOMRect
  }
  document.head.innerHTML = `<style>${BASE}</style>`
  document.title = 'Acme'
})
afterEach(() => {
  Element.prototype.getBoundingClientRect = original
  document.body.innerHTML = ''
})

const LOGO =
  '<a href="/"><img data-rect="24,40,180,50" src="https://acme.example/logo.svg" alt="Acme"></a>'
const MENU = ['About', 'Downloads', 'Docs', 'Community']
  .map(
    (word, i) =>
      `<a href="/${word}" data-rect="40,${500 + i * 120},90,24" style="color: rgb(255, 255, 255)">${word}</a>`
  )
  .join('')
const band = (inner: string, style = 'background-color: rgb(43, 91, 132)', rect = '0,0,1440,586') =>
  `<div data-rect="${rect}" style="${style}">${LOGO}<nav>${MENU}</nav>${inner}</div><main><p>Body copy.</p></main>`
/** The measurement first (it finds the logo and leaves it for this pass), then the band. */
const read = (html: string) => {
  document.body.innerHTML = html
  const first = measureBrandPage().header
  return { first, band: measureHeaderBand() }
}

describe('measureHeaderBand', () => {
  it('takes a tall band of one solid colour that holds the logo and the menu', () => {
    const { first, band: found } = read(
      band('<h1 data-rect="200,40,800,80">Parcels, delivered</h1>')
    )
    expect(first).toBeNull()
    expect(found).toEqual({ bg: 'rgb(43, 91, 132)', text: 'rgb(255, 255, 255)', tall: true })
  })

  it('takes two near shades of one colour for that colour: the shade the logo sits on', () => {
    const shaded = band(
      '',
      'background-color: rgb(43, 91, 132); background-image: linear-gradient(rgb(30, 65, 94) 10%, rgb(43, 91, 132) 90%)'
    )
    expect(read(shaded).band).toEqual({
      bg: 'rgb(30, 65, 94)',
      text: 'rgb(255, 255, 255)',
      tall: true,
    })
  })

  it.each([
    [
      'a gradient',
      band('', 'background-image: linear-gradient(rgb(43, 91, 132), rgb(10, 20, 30))'),
    ],
    [
      'a picture behind it',
      band('', 'background-color: rgb(43, 91, 132); background-image: url(hero.jpg)'),
    ],
    [
      'a gradient that fades out',
      band('', 'background-image: linear-gradient(rgb(43, 91, 132), rgba(43, 91, 132, 0))'),
    ],
    ['a see-through fill', band('', 'background-color: rgba(43, 91, 132, 0.6)')],
    [
      'a photo covering it',
      band('<img data-rect="100,0,1440,480" src="https://acme.example/hero.jpg">'),
    ],
    ['a video in it', band('<video data-rect="120,200,1000,440"></video>')],
    [
      'a picture painted on a box in it',
      band('<div data-rect="90,0,1440,490" style="background-image: url(hero.jpg)"></div>'),
    ],
    [
      'a gradient laid over it',
      band(
        '<div data-rect="0,0,1440,586" style="background-image: linear-gradient(rgba(0,0,0,0), rgb(0,0,0))"></div>'
      ),
    ],
    ['the whole page’s wrapper', band('', 'background-color: rgb(43, 91, 132)', '0,0,1440,4200')],
    [
      'no menu beside the logo',
      `<div data-rect="0,0,1440,586" style="background-color: rgb(43, 91, 132)">${LOGO}<a href="/start" data-rect="400,40,120,40">Get started</a></div>`,
    ],
    [
      'a menu far below the logo',
      `<div data-rect="0,0,1440,586" style="background-color: rgb(43, 91, 132)">${LOGO}<nav>${MENU.replaceAll('data-rect="40,', 'data-rect="480,')}</nav></div>`,
    ],
  ])('has none for a tall band with %s', (_why, html) => {
    expect(read(html).band).toBeNull()
  })

  it('leaves an ordinary bar to the measurement, and has none where that found none', () => {
    const bar = read(
      `<header data-rect="0,0,1440,64" style="background-color: rgb(0, 94, 184)">${LOGO}<nav>${MENU}</nav></header>`
    )
    expect(bar.first).toEqual({ bg: 'rgb(0, 94, 184)', text: 'rgb(255, 255, 255)' })
    expect(bar.band).toBeNull()
    expect(
      read(`<header data-rect="0,0,1440,64">${LOGO}<nav>${MENU}</nav></header>`).band
    ).toBeNull()
    expect(read('<p>No logo here</p>').band).toBeNull()
  })
})
