/**
 * A brand's type and shapes, read from its HTML and CSS: the rules that match
 * each element apply in cascade order, sizes resolve as a wide screen sees
 * them, and what cannot be read stays unmeasured.
 */
import { describe, expect, it } from 'vitest'
import { measureSite } from '../site-measure'

const PAGE = `<html><body>
  <header><a class="btn btn--primary" href="/signup">Sign up</a></header>
  <h1 class="hero__title text-display">Payments infrastructure</h1>
  <h2 class="section-title">Modular solutions</h2>
  <div class="card card--feature">A card</div>
  <input type="email" class="field">
</body></html>`

describe('measuring a brand from its page', () => {
  it('applies the matching rules in cascade order, utility classes included', () => {
    const m = measureSite(PAGE, [
      `:root { --hero: clamp(2rem, 4vw, 3rem); --brand-radius: 4px }
       h1 { font-size: 2em; font-weight: 700 }
       .text-display { font-size: var(--hero); font-weight: 300; letter-spacing: -0.02em; line-height: 1.15 }
       .section-title { font: 300 2rem/1.1 sohne, sans-serif }
       .btn { border-radius: 999px; min-height: 2.5rem }
       .btn--primary { border-radius: var(--brand-radius) }
       .card { border-radius: 6px; box-shadow: none; border: 1px solid #eee }
       input.field { border-radius: 8px }`,
    ])
    expect(m.headline).toEqual({ size: 48, weight: 300, tracking: -0.02, leading: 1.15 })
    expect(m.heading).toEqual({ size: 32, weight: 300, leading: 1.1 })
    expect(m.button).toEqual({ radius: 4, height: 40 })
    expect(m.card).toEqual({ radius: 6, borderWidth: 1, shadow: false })
    expect(m.field).toEqual({ radius: 8 })
  })

  it('reads the colours and type of the headline and the button', () => {
    const m = measureSite(PAGE, [
      `:root { --forest: #163300 }
       .text-display { font-size: 64px; color: var(--forest) }
       .btn--primary { background: rgb(22, 51, 0); color: #9fe870; font-weight: 600; text-transform: uppercase }`,
    ])
    expect(m.headline).toEqual({ size: 64, colour: '#163300' })
    expect(m.button).toEqual({
      fill: '#163300',
      ink: '#9fe870',
      weight: 600,
      upper: true,
      action: true,
    })
  })

  it('reads a wide, light screen: small-screen and dark rules are left out', () => {
    const m = measureSite(PAGE, [
      `.text-display { font-size: 64px }
       @media (max-width: 600px) { .text-display { font-size: 28px } }
       @media (prefers-color-scheme: dark) { .text-display { font-size: 12px } }
       @media (min-width: 1024px) { .text-display { font-size: 72px } }`,
    ])
    expect(m.headline?.size).toBe(72)
  })

  it('leaves out what it cannot read rather than guess', () => {
    const m = measureSite(PAGE, [
      `.text-display:hover { font-size: 90px }
       [data-theme] h1 { font-size: 90px }
       .btn { border-radius: var(--missing) }`,
    ])
    expect(m.headline).toBeNull()
    expect(m.button).toBeNull()
    expect(m.card).toBeNull()
  })

  it('takes the largest headline in sight, past a reset’s default and a hidden one', () => {
    const page = `<h1 class="sr-only">Skip</h1><h1 class="label overflow-hidden">Pricing</h1>
      <h1 class="hero">Money without borders</h1>`
    const m = measureSite(page, [
      `h1 { font-size: 2em } .sr-only { font-size: 120px } .label { font-size: 14px } .hero { font-size: 104px }`,
    ])
    expect(m.headline?.size).toBe(104)
    // A page whose only headline size is the reset's says nothing about its headline.
    expect(measureSite('<h1>Hi</h1>', ['h1 { font-size: 2em }']).headline).toBeNull()
  })

  it('takes the button filled with the site’s own button colour', () => {
    const page = `<a class="btn btn-secondary">Log in</a><a class="btn btn-primary">Send money</a>`
    const css = [
      `.btn-secondary { background: #37517e } .btn-primary { background: #163300; border-radius: 999px }`,
    ]
    expect(measureSite(page, css, '#163300').button).toEqual({
      radius: 999,
      fill: '#163300',
      action: true,
    })
    // Its words make it the call to action without the colour, ahead of signing in.
    expect(measureSite(page, css).button?.fill).toBe('#163300')
  })

  it('takes the call to action the page leads with, past sign-in links and cookie notices', () => {
    const page = `<header><a class="btn nav-login">Log in</a><a class="btn btn-get">Get started</a></header>
      <button class="btn cookie-accept">Accept all</button>
      ${'<p>Copy</p>'.repeat(40)}
      <a class="btn btn-old">Get started</a>`
    const m = measureSite(page, [
      `.nav-login { background: #e5e5e5 } .btn-get { background: #533afd; border-radius: 4px }
       .cookie-accept { background: #091723 } .btn-old { background: #0081ba }`,
    ])
    expect(m.button).toEqual({ radius: 4, fill: '#533afd', action: true })
  })

  it('reads colours a site keeps under a theme class on its body', () => {
    const page = `<body class="theme-personal"><a class="cta">Send money</a></body>`
    const m = measureSite(page, [
      `:root { --accent: #0081ba } .theme-personal { --accent: #9fe870 } .cta { background: var(--accent) }`,
    ])
    expect(m.button?.fill).toBe('#9fe870')
  })

  it('does not call a link a call to action without the words or the place for it', () => {
    const page = `${'<p>Copy</p>'.repeat(40)}<a class="btn footer">Careers</a>`
    const m = measureSite(page, [`.footer { background: #333333 }`])
    expect(m.button?.action).toBeUndefined()
  })

  it('inherits colours from a theme a wrapper sets, past the stylesheet default', () => {
    const page = `<body><div class="theme-bright"><nav><a class="cta">Send money</a></nav></div></body>`
    const m = measureSite(page, [
      `:root { --accent: #0081ba } .theme-bright { --accent: #9fe870 } .cta { background: var(--accent) }`,
    ])
    expect(m.button?.fill).toBe('#9fe870')
  })

  it('reads a token a palette class on an ancestor chooses', () => {
    const page = `<main class="tokens palette-blue"><section><a class="button primary">Get it free</a></section></main>`
    const m = measureSite(page, [
      `.tokens { --blue-600: #0075de; --button-bg: var(--grey-900) }
       .palette-blue { --button-bg: var(--blue-600) }
       :root { --grey-900: #191918 }
       .primary { background-color: var(--button-bg) }`,
    ])
    expect(m.button?.fill).toBe('#0075de')
  })

  it('reads a fill set in a style attribute', () => {
    const page = `<a class="btn" style="background-color: #ff4f40">Get started</a>`
    expect(measureSite(page, [`.btn { background: #333333 }`]).button?.fill).toBe('#ff4f40')
  })

  it('passes over buttons inside a consent banner, whatever their words', () => {
    const page = `<div id="cookie-banner"><a class="btn">Get started</a></div>
      <header><a class="btn brand">Sign up</a></header>`
    const m = measureSite(page, [`.btn { background: #091723 } .brand { background: #533afd }`])
    expect(m.button?.fill).toBe('#533afd')
  })

  it('sizes a headline set in viewport height at a standard screen', () => {
    const page = `<h1 class="hero">Payments</h1>`
    const css = [`h1.hero { --flex: 6lvh; font-size: max(min(var(--flex), 64px), 32px) }`]
    expect(measureSite(page, css).headline?.size).toBe(54)
  })

  it('inherits a colour and weight from above, as the page shows them', () => {
    const page = `<section class="hero"><h1 class="title">Payments</h1><a class="btn">Get started</a></section>`
    const css = [
      `.hero { --ink: #061b31; color: var(--ink); font-weight: 300 }
       .title { font-size: 48px } .btn { background: #533afd }
       .inner { --ink: #ff0000 }`,
    ]
    const m = measureSite(page, css)
    expect(m.headline).toMatchObject({ size: 48, weight: 300, colour: '#061b31' })
    expect(m.button?.ink).toBe('#061b31')
  })

  it('leaves out repaints for one browser engine or a wide-gamut screen', () => {
    const page = `<h1 class="title">Payments</h1>`
    const css = [
      `.title { font-size: 48px; color: #061b31 }
       @supports (-webkit-touch-callout: none) { .title { color: #c8c33b } }
       @media (color-gamut: p3) { .title { color: #ddd600 } }`,
    ]
    expect(measureSite(page, css).headline?.colour).toBe('#061b31')
  })
})
