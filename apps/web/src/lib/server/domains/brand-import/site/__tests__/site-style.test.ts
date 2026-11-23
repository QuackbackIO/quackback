import { describe, expect, it } from 'vitest'
import { pageElements, readPageStyle } from '../site-style'

const page = (body: string, attrs = '') =>
  `<!doctype html><html${attrs}><head></head><body>${body}</body></html>`

describe('pageElements', () => {
  it('finds the root and body, the buttons and the cards', () => {
    const els = pageElements(
      page(
        `<nav><a href="/">Home</a><a class="nav-link">Docs</a></nav>
         <a class="btn btn--primary" href="/start">Start</a>
         <div class="product-card">One</div>`,
        ' class="theme-light" data-theme="light"'
      ).replace('<body>', '<body class="page home">')
    )
    expect(els).toEqual({
      html: {
        tag: 'html',
        classes: ['theme-light'],
        attrs: { class: 'theme-light', 'data-theme': 'light' },
      },
      body: { tag: 'body', classes: ['page', 'home'], attrs: { class: 'page home' } },
      buttons: [
        {
          tag: 'a',
          classes: ['btn', 'btn--primary'],
          attrs: { class: 'btn btn--primary', href: '/start' },
        },
      ],
      cards: [{ tag: 'div', classes: ['product-card'], attrs: { class: 'product-card' } }],
      dark: false,
    })
  })

  it('never takes a consent banner button for one of the page', () => {
    const els = pageElements(
      page(
        `<div id="onetrust-banner"><div><button class="ot-btn cookie-accept-button">Accept</button></div></div>
         <a class="ctaButton">Try it</a>`
      )
    )
    expect(els.buttons.map((b) => b.classes)).toEqual([['ctaButton']])
  })

  it('reads a utility-styled link with a fill and rounding as a button', () => {
    const els = pageElements(page('<a class="inline-flex rounded-[4px] bg-black px-4">Go</a>'))
    expect(els.buttons[0]?.classes).toContain('rounded-[4px]')
  })

  it('takes plain button elements when nothing is named as one', () => {
    expect(pageElements(page('<button type="submit">Go</button>')).buttons).toEqual([
      { tag: 'button', classes: [], attrs: { type: 'submit' } },
    ])
  })

  it('knows a page its markup calls dark', () => {
    expect(pageElements(page('', ' data-theme="dark"')).dark).toBe(true)
    expect(pageElements(page('', ' class="dark"')).dark).toBe(true)
    expect(pageElements(page('', ' style="color-scheme: dark"')).dark).toBe(true)
    expect(pageElements(page('', ' class="darkroom"')).dark).toBe(false)
  })
})

describe('readPageStyle', () => {
  const style = (css: string, html: string) => readPageStyle([css], pageElements(html))

  it('reads the page colours from body over html and :root, through custom properties', () => {
    const css = `:root{--surface:#fffefb;--ink:#111111}
      html{background:#ffffff;color:#333333}
      body{background:var(--surface);color:var(--ink)}`
    expect(style(css, page(''))).toMatchObject({ background: '#fffefb', text: '#111111' })
  })

  it('reads a body class and a later rule over an earlier one', () => {
    const css = `body{background:#ffffff} .dark-page{background-color:#08090a;color:#f7f8f8} body{color:#000000}`
    const html = page('').replace('<body>', '<body class="dark-page">')
    expect(style(css, html)).toMatchObject({ background: '#08090a', text: '#f7f8f8' })
  })

  it('leaves out dark-scheme, small-screen and print rules', () => {
    const css = `body{background:#ffffff;color:#000000}
      @media (prefers-color-scheme: dark){body{background:#000000;color:#ffffff}}
      @media (max-width: 600px){body{background:#ff0000}}
      @media print{body{color:#00ff00}}
      @media (min-width: 1024px){body{color:#1d3557}}`
    expect(style(css, page(''))).toMatchObject({ background: '#ffffff', text: '#1d3557' })
  })

  it('reads an undeclared or transparent page as transparent, and nothing at all as unknown', () => {
    expect(style('body{color:#000}', page('')).background).toBe('transparent')
    expect(style('body{background:transparent}', page('')).background).toBe('transparent')
    expect(readPageStyle([], pageElements(page('')))).toMatchObject({
      background: null,
      text: null,
    })
  })

  it('reads the main button: fill, radius in px or %, and height', () => {
    const html = page('<a class="btn btn--primary">Go</a>')
    const css = `:root{--radius-button:0.25rem}
      .btn{border-radius:var(--radius-button);height:2.5rem;background:#eeeeee}
      .btn--primary{background-color:#533afd}
      .btn:hover{border-radius:0}
      .footer .btn{border-radius:99px}`
    expect(style(css, html).button).toEqual({ fill: '#533afd', radiusPx: 4, heightPx: 40 })
    expect(style('.btn{border-radius:50%}', html).button).toEqual({ radiusPercent: 50 })
    expect(style('.btn{border-radius:9999px 9999px 9999px 9999px}', html).button).toEqual({
      radiusPx: 9999,
    })
  })

  it('reads escaped utility classes', () => {
    const html = page('<a class="rounded-[8px] bg-[#0075de] h-9">Go</a>')
    const css = `.rounded-\\[8px\\]{border-radius:8px}.bg-\\[\\#0075de\\]{background-color:#0075de}.h-9{height:2.25rem}`
    expect(style(css, html).button).toEqual({ fill: '#0075de', radiusPx: 8, heightPx: 36 })
  })

  it('takes the most prominent button, and no fill from a quiet one', () => {
    const html = page(
      `<a class="btn btn-secondary">Docs</a><a class="btn btn-ghost">Log in</a><a class="btn btn-primary">Start</a>`
    )
    const css = `.btn{border-radius:8px}.btn-secondary{background:#dadada}.btn-ghost{background:transparent}
      .btn-primary{background:#0075de;border-radius:4px}`
    expect(style(css, html).button).toEqual({ fill: '#0075de', radiusPx: 4 })
    // Only quiet buttons: the shape is read, the fill is not.
    expect(
      style('.btn{border-radius:8px;background:#dadada}', page('<a class="btn">Go</a>')).button
    ).toEqual({ radiusPx: 8 })
    // Light on a dark page stands out.
    const dark = page('<a class="btn">Go</a>').replace('<body>', '<body class="d">')
    expect(
      style('.d{background:#08090a}.btn{background:#e5e5e6;border-radius:9999px}', dark).button
    ).toEqual({ fill: '#e5e5e6', radiusPx: 9999 })
  })

  it('resolves custom properties a class on the root sets, as the page inherits them', () => {
    const html = page('<a class="button button-primary">Go</a>', ' class="theme-blue"')
    const css = `.theme-brown{--button-bg:#744d2d}.theme-blue{--button-bg:#0075de}.theme-red{--button-bg:#d00000}
      .button-primary{background:var(--button-bg)}`
    expect(style(css, html).button?.fill).toBe('#0075de')
  })

  it('reads rules that select the root by an attribute', () => {
    const html = page('', ' data-theme="dark"')
    const css = `:root{--bg:#ffffff}[data-theme=dark]{--bg:#08090a}html[data-theme="dark"] body{color:red}
      body{background:var(--bg)}`
    expect(style(css, html).background).toBe('#08090a')
  })

  it('takes a dark page its markup calls dark from its theme colour when its CSS is out of reach', () => {
    const html = page('', ' data-theme="dark"')
    expect(
      readPageStyle(['body{margin:0}'], pageElements(html), { themeColour: '#08090a' }).background
    ).toBe('#08090a')
    // A light theme colour, or a page not called dark, is no page colour.
    expect(
      readPageStyle(['body{margin:0}'], pageElements(html), { themeColour: '#f4f4f4' }).background
    ).toBe('transparent')
    expect(
      readPageStyle(['body{margin:0}'], pageElements(page('')), { themeColour: '#08090a' })
        .background
    ).toBe('transparent')
  })

  it('reads a card radius', () => {
    const html = page('<div class="card">One</div>')
    expect(style('.card{border-radius:12px}', html).cardRadiusPx).toBe(12)
    expect(style('.other{border-radius:12px}', html).cardRadiusPx).toBeNull()
    // A square-cornered card is usually a layout wrapper; the first rounded one counts.
    const two = page('<div class="card-grid">x</div><div class="card">One</div>')
    expect(style('.card-grid{border-radius:0}.card{border-radius:12px}', two).cardRadiusPx).toBe(12)
  })
})

describe('selectors', () => {
  it('reads a long attribute selector quickly', () => {
    const selector = '[a-=' + '""][a-='.repeat(40) + '!'
    const started = performance.now()
    pageElements(
      page('<button class="b">Go</button>', '').replace(
        '<head></head>',
        `<head><style>${selector}{color:red}</style></head>`
      )
    )
    expect(performance.now() - started).toBeLessThan(500)
  })
})
