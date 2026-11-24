/**
 * The measurement the browser reader runs inside a rendered page. It reads
 * the body's colours and font, as the measured fixtures were read
 * (fixtures/brand-sites/measure.mjs), and beside them what the fixtures
 * lacked: every filled button with its words, size, place and whether a
 * cookie banner holds it; the font and colour most words are set in; and
 * whether the page is a bot check's wall. It never chooses: the reader picks
 * the brand's button in plain code (measure-read.ts), where it is tested and
 * can be replayed. Also the largest heading's font and the image that reads
 * most as the site's logo, its paints written in so it draws on its own. It
 * reads no card: the first rounded box on a page is seldom the site's card (on some of the
 * measured sites it set the wrong corners), so corners come from the
 * main button, as the fixtures' do. Self-contained: it is sent as its source text and runs in
 * the page, so it refers to nothing outside its own body.
 */

import type { PageLogo, PageMeasure, PageSurface } from './page-measure.types'

export type {
  PageButton,
  PageFontFace,
  PageSiteFont,
  PageCandidate,
  PageDarkMeasure,
  PageLogo,
  PageMeasure,
  PageSurface,
} from './page-measure.types'

export function measureBrandPage(): PageMeasure {
  const SVG_MAX = 300_000
  const cs = (el: Element) => getComputedStyle(el)
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect()
    const s = cs(el)
    return (
      r.width > 20 &&
      r.height > 14 &&
      r.top < 1400 &&
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      Number(s.opacity) > 0.5
    )
  }
  const CONSENT_MARKUP =
    /cookie|consent|gdpr|onetrust|optanon|ot-sdk|cookiebot|cybot|didomi|usercentrics|truste|trustarc|osano|termly|iubenda|klaro|ketch-|qc-cmp|\bcmp\b|\bcky-|\bcc-(?:window|banner|btn|revoke)|privacy[-_ ]?(?:banner|notice|prompt|manager|cent(?:er|re)|settings|preferences|choices|modal|popup|bar|overlay)|tracking[-_ ]?(?:banner|consent|notice|prompt|preferences)/i
  const CONSENT_TEXT = /cookie|consent|gdpr/i
  const markupOf = (el: Element) =>
    `${el.id} ${el.getAttribute('class') || ''} ${el.getAttribute('aria-label') || ''}`
  /** In a consent banner: named so, or a fixed or modal layer that talks about cookies. */
  const consent = (el: Element) => {
    for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
      if (CONSENT_MARKUP.test(markupOf(at))) return true
      if (at.tagName === 'HEADER') continue
      const position = cs(at).position
      const layer =
        position === 'fixed' ||
        position === 'sticky' ||
        at.tagName === 'DIALOG' ||
        at.getAttribute('role') === 'dialog' ||
        at.getAttribute('aria-modal') === 'true'
      if (layer && CONSENT_TEXT.test(at.textContent || '')) return true
    }
    return false
  }
  const isTransparent = (c: string) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
  /** A fill too faint to read as one: under half opaque. */
  const faint = (c: string) => {
    if (isTransparent(c)) return true
    // rgba(r, g, b, a), or the `/ a` of rgb(), oklch() and friends.
    const alpha = /(?:,|\/)\s*([\d.]+)(%?)\s*\)$/.exec(c)
    if (!alpha || (c.startsWith('rgb(') && !c.includes('/'))) return false
    return Number(alpha[1]) / (alpha[2] ? 100 : 1) < 0.5
  }
  /** A fill nothing shows through: fully, or all but fully, opaque. */
  const solid = (c: string) => {
    if (isTransparent(c)) return false
    const alpha = /(?:,|\/)\s*([\d.]+)(%?)\s*\)$/.exec(c)
    if (!alpha || (c.startsWith('rgb(') && !c.includes('/'))) return true
    return Number(alpha[1]) / (alpha[2] ? 100 : 1) >= 0.95
  }
  const words = (el: Element) => (el.textContent || '').trim()

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  const body = cs(document.body)
  let bg = body.backgroundColor
  if (isTransparent(bg)) bg = cs(document.documentElement).backgroundColor
  // Neither paints: the page may be a wrapper's, marked by the pass before this one (page-painted.ts).
  const marked = (window as unknown as Record<symbol, unknown>)[Symbol.for('quackback.page')]
  const wraps = marked instanceof Element && document.body.contains(marked) && isTransparent(bg)
  /** Where the page itself starts: the body, or the wrapper that paints it. */
  const pageEl = wraps && solid(cs(marked).backgroundColor) ? marked : document.body
  if (pageEl !== document.body) bg = cs(pageEl).backgroundColor

  const headerEl = document.querySelector('header') || document.querySelector('nav')
  /**
   * What a button is filled with: its own background, else the colour its
   * pseudo-element, a box covering it, or its gradient paints. Many sites
   * draw a call to action's fill on an inner box with the link left clear.
   */
  const fillOf = (el: Element): { bg: string; fg: string } => {
    const own = cs(el)
    if (!faint(own.backgroundColor)) return { bg: own.backgroundColor, fg: own.color }
    const r = el.getBoundingClientRect()
    for (const pseudo of ['::before', '::after']) {
      const p = getComputedStyle(el, pseudo)
      // Only a layer covering the button fills it; a tab's thin underline does not.
      const tall = parseFloat(p.height) >= 0.8 * r.height || p.height === 'auto'
      const drawn = p.content && p.content !== 'none' && p.content !== 'normal'
      if (drawn && tall && !faint(p.backgroundColor))
        return { bg: p.backgroundColor, fg: own.color }
    }
    for (const child of [...el.querySelectorAll('*')].slice(0, 30)) {
      const c = child.getBoundingClientRect()
      const covers = c.width * c.height >= 0.8 * r.width * r.height
      const style = cs(child)
      // The words take the colour of the box that fills the button.
      if (covers && !faint(style.backgroundColor))
        return { bg: style.backgroundColor, fg: style.color }
    }
    const stop = /(?:rgba?|hsla?|oklch|oklab)\([^)]*\)/.exec(own.backgroundImage || '')
    return { bg: stop && !faint(stop[0]) ? stop[0] : own.backgroundColor, fg: own.color }
  }

  // Filled buttons only: plain links never win, and a long menu of them
  // would crowd the call to action out of the list.
  const candidates = [...document.querySelectorAll('a,button')]
    .filter((el) => vis(el) && words(el).length > 1 && words(el).length < 40)
    .map((el) => ({ el, fill: fillOf(el) }))
    .filter(({ fill }) => !faint(fill.bg))
    .slice(0, 40)
    .map(({ el, fill }) => {
      const s = cs(el)
      const r = el.getBoundingClientRect()
      return {
        bg: fill.bg,
        fg: fill.fg,
        radius: s.borderRadius,
        h: Math.round(r.height),
        w: Math.round(r.width),
        top: Math.round(r.top),
        text: words(el).replace(/\s+/g, ' ').slice(0, 40),
        header: Boolean(headerEl?.contains(el)),
        overlay: consent(el),
      }
    })
  const buttons = candidates
    .filter((c) => !c.overlay && c.bg !== bg)
    .slice(0, 6)
    .map(({ bg: fill, fg, radius, h }) => ({ bg: fill, fg, radius, h }))

  // The font and colour most words are set in: the body's is often the
  // browser's default, with the brand's set on a wrapper inside it.
  const fontWeight = new Map<string, number>()
  const colourWeight = new Map<string, number>()
  const surfaceWeight = new Map<string, PageSurface>()
  const borderCount = new Map<string, number>()
  /** The first filled box behind `el`'s words, or null on the page itself, a photo or a button. */
  const surfaceOf = (el: Element): Element | null => {
    for (let at: Element | null = el; at && at !== pageEl; at = at.parentElement) {
      const s = cs(at)
      if (s.backgroundImage && s.backgroundImage !== 'none') return null
      if (!faint(s.backgroundColor)) return at.closest('a,button') ? null : at
    }
    return null
  }
  /** Whether `el`'s words sit on the page itself: no filled band, box or photo behind them. */
  const onPage = (el: Element): boolean => {
    for (let at: Element | null = el; at && at !== pageEl; at = at.parentElement) {
      const s = cs(at)
      if ((s.backgroundImage && s.backgroundImage !== 'none') || !faint(s.backgroundColor))
        return false
    }
    return true
  }
  // The page's own text colours: a hero's big white words on a dark band
  // or a photo outweigh the body copy otherwise.
  const pageColourWeight = new Map<string, number>()
  let scanned = 0
  for (const el of document.body.querySelectorAll('*')) {
    if (scanned++ > 4000) break
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
    const r = el.getBoundingClientRect()
    if (r.top > 1400 || r.width === 0) continue
    const s = cs(el)
    if (s.visibility === 'hidden') continue
    const width = parseFloat(s.borderTopWidth) || 0
    if (width >= 1 && s.borderTopStyle !== 'none' && !faint(s.borderTopColor) && !consent(el))
      borderCount.set(s.borderTopColor, (borderCount.get(s.borderTopColor) || 0) + 1)
    let own = 0
    for (const node of el.childNodes)
      if (node.nodeType === 3) own += (node.textContent || '').trim().length
    if (own < 2 || consent(el)) continue
    fontWeight.set(s.fontFamily, (fontWeight.get(s.fontFamily) || 0) + own)
    // The page's text colour is its words', not its links' (often a brand or visited colour).
    if (!el.closest('a,button')) {
      colourWeight.set(s.color, (colourWeight.get(s.color) || 0) + own)
      if (onPage(el)) pageColourWeight.set(s.color, (pageColourWeight.get(s.color) || 0) + own)
    }
    const box = surfaceOf(el)
    if (box) {
      const b = cs(box)
      const known = surfaceWeight.get(b.backgroundColor)
      const entry = known ?? {
        bg: b.backgroundColor,
        chars: 0,
        rounded: false,
        bordered: false,
        shadowed: false,
        wide: false,
      }
      entry.chars += own
      entry.rounded ||= (parseFloat(b.borderTopLeftRadius) || 0) > 0
      entry.bordered ||= (parseFloat(b.borderTopWidth) || 0) >= 1
      entry.shadowed ||= Boolean(b.boxShadow) && b.boxShadow !== 'none'
      entry.wide ||= box.getBoundingClientRect().width >= 0.9 * window.innerWidth
      surfaceWeight.set(b.backgroundColor, entry)
    }
  }
  const most = (weights: Map<string, number>) => [...weights].sort((a, b) => b[1] - a[1])[0]?.[0]
  const textFont = most(fontWeight)
  // The words on the page, else (a page that is all bands) every word.
  const wordColours = pageColourWeight.size > 0 ? pageColourWeight : colourWeight
  const textColor = most(wordColours)
  const surfaces = [...surfaceWeight.values()].sort((a, b) => b.chars - a.chars).slice(0, 12)
  const texts = [...wordColours]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([color, chars]) => ({ color, chars }))
  const borders = [...borderCount]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([color, count]) => ({ color, count }))

  const h1 = [...document.querySelectorAll('h1,h2')]
    .filter(vis)
    .sort((a, b) => parseFloat(cs(b).fontSize) - parseFloat(cs(a).fontSize))[0]

  // The logo: of the images near the top, the one most marked as the site's
  // own. It links home, is named a logo, or is labelled with the site's name;
  // the more of these the better. An image marked in none of them counts only
  // inside the header, and only when it is no icon, banner or photo. Among
  // equals a drawing beats a photo, a wide or square shape a tall one, the
  // left the right, and the first the rest.
  const NEAR_TOP = 600
  const LOGO_NAMED = /logo|wordmark|brand/i
  // A photo by its file type, or by the crop its image service was asked for.
  const PHOTO = /\.(?:jpe?g|webp|avif)\b|[?&](?:crop|resize|fit)=/i
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const siteOf = (host: string) => host.replace(/^www\./, '')
  // The host's longest label short of its ending: "acme" of www.acme.co.uk.
  const hostName =
    location.hostname
      .split('.')
      .slice(0, -1)
      .sort((a, b) => b.length - a.length)[0] || ''
  const pageTitle = plain(document.title)
  /** Names the site: holds the host's name, or is how the page's title starts or ends. */
  const saysSite = (label: string) => {
    const said = plain(label)
    if (said.length < 3) return false
    return (
      (hostName.length >= 3 && said.includes(hostName)) ||
      pageTitle.startsWith(said) ||
      pageTitle.endsWith(said)
    )
  }
  // Home: the site's root, a language's or country's home (/en-gb, /gb/en/),
  // /home, an index file, the page being read, or wherever a link labelled "home" or
  // "homepage" goes.
  const HOME_PATH =
    /^(?:\/[a-z]{2}(?:[-_][a-z]{2})?){0,2}\/?$|^\/index\.[\w.-]+$|^\/home(?:\.html?)?\/?$/i
  const HOME_LABEL = /\bhome(?:\s?page)?\s*$/i
  const goesHome = (link: Element) => {
    const href = link.getAttribute('href') || ''
    // A jump within the page (a skip link) goes nowhere.
    if (href.startsWith('#')) return false
    try {
      const to = new URL(href, location.href)
      const there = siteOf(to.hostname)
      const here = siteOf(location.hostname)
      const sameSite = there === here || there.endsWith(`.${here}`) || here.endsWith(`.${there}`)
      const samePage = to.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '')
      const saysHome = HOME_LABEL.test(attrs(link, ['aria-label']) || attrs(link, ['title']))
      return sameSite && (saysHome || HOME_PATH.test(to.pathname) || samePage)
    } catch {
      return false
    }
  }
  const attrs = (el: Element | null | undefined, names: string[]) =>
    names.map((name) => el?.getAttribute(name) || '').join(' ')
  /** How strongly an image reads as the site's logo; 0 when it cannot be one. */
  const logoRank = (el: Element): number => {
    const r = el.getBoundingClientRect()
    const s = cs(el)
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) <= 0.5) return 0
    // A speck, a photo-sized box, or off the first screen.
    if (r.width < 12 || r.height < 12 || r.width > 800 || r.height > 200) return 0
    if (r.top >= NEAR_TOP || r.bottom <= 0 || r.right <= 0) return 0
    // A button's icon: a menu, a search, a flag.
    if (el.closest('button, [role="button"]')) return 0
    const link = el.closest('a[href]')
    const home = Boolean(link && goesHome(link))
    const away = Boolean(link) && !home
    const src = el instanceof HTMLImageElement ? el.currentSrc || el.src : ''
    const photo = PHOTO.test(src)
    // What it and the boxes round it, up to its link, are called.
    let called = attrs(el, ['class', 'id', 'alt', 'aria-label', 'src'])
    for (let at = el.parentElement, up = 0; at && up < 3; at = at.parentElement, up++) {
      called += ` ${attrs(at, ['class', 'id'])}`
      if (at === link) break
    }
    const label = `${attrs(el, ['alt', 'aria-label', 'title'])} ${el.querySelector('title')?.textContent || ''} ${attrs(link, ['aria-label', 'title'])}`
    // A link to another page makes it that page's logo, whatever it is called.
    const marks =
      Number(home) + Number(!away && LOGO_NAMED.test(called)) + Number(!away && saysSite(label))
    const inHeader = Boolean(headerEl?.contains(el))
    // Unmarked, it must look the part: no icon, banner or photo.
    const plainLooking = Math.max(r.width, r.height) > 28 && r.width <= 400 && !photo
    if (!marks && !(inHeader && plainLooking)) return 0
    const drawn = el.tagName.toLowerCase() === 'svg' || /\.svg\b/i.test(src)
    return (
      1 +
      marks * 10 +
      (inHeader ? 2 : 0) +
      Number(drawn) -
      Number(photo) +
      Number(r.width >= r.height) +
      Number(r.left < innerWidth / 2)
    )
  }
  let logoEl: Element | undefined
  let logoBest = 0
  for (const el of document.body.querySelectorAll('img,svg')) {
    const rank = logoRank(el)
    if (rank > logoBest) [logoEl, logoBest] = [el, rank]
  }
  // A logo painted as a background picture leaves no image to take, but its
  // link still marks the bar: the header's link home, or one named a logo.
  const barFrom =
    logoEl ??
    [...(headerEl?.querySelectorAll('a[href]') ?? [])].find(
      (a) =>
        vis(a) &&
        a.getBoundingClientRect().top < NEAR_TOP &&
        (goesHome(a) || LOGO_NAMED.test(attrs(a, ['class', 'id'])))
    )
  // Kept for the reader's later passes over the same page (page-extras.ts, page-header-band.ts).
  const kept = { logo: logoEl, bar: barFrom }
  ;(window as unknown as Record<symbol, unknown>)[Symbol.for('quackback.reader')] = kept
  let logo: PageLogo | null = null
  if (logoEl) {
    const r = logoEl.getBoundingClientRect()
    logo = {
      tag: logoEl.tagName,
      src: logoEl instanceof HTMLImageElement ? logoEl.currentSrc || logoEl.src || null : null,
      w: Math.round(r.width),
      h: Math.round(r.height),
    }
    if (!(logoEl instanceof HTMLImageElement)) {
      // A logo drawn from a sprite: bring the symbols it uses along.
      const copy = logoEl.cloneNode(true) as Element
      // Paint a stylesheet or CSS variable sets means nothing outside the page:
      // write what each shape draws with into its markup.
      const SHAPES = new Set(
        'path rect circle ellipse line polyline polygon text tspan use'.split(' ')
      )
      const drawn = [logoEl, ...logoEl.querySelectorAll('*')]
      const copied = [copy, ...copy.querySelectorAll('*')]
      drawn.forEach((el, i) => {
        const target = copied[i]
        if (!target) return
        const shape = SHAPES.has(el.tagName.toLowerCase())
        for (const paint of ['fill', 'stroke'] as const) {
          const given = (el.getAttribute(paint) || '') + (el.getAttribute('style') || '')
          // A shape kept in defs or a symbol is painted by whatever uses it, not by its own style.
          if ((!shape || el.closest('defs, symbol')) && !given.includes('var(')) continue
          const value = cs(el).getPropertyValue(paint)
          if (!value || value.startsWith('url(')) continue
          target.setAttribute(paint, value)
        }
        if (target.getAttribute('style')?.includes('var(')) target.removeAttribute('style')
      })
      const used = [...copy.querySelectorAll('use')]
        .map((use) => (use.getAttribute('href') || use.getAttribute('xlink:href') || '').trim())
        .filter((href) => href.startsWith('#'))
      const defs: string[] = []
      for (const href of new Set(used)) {
        const target = document.getElementById(href.slice(1))
        if (target && !logoEl.contains(target)) defs.push(target.outerHTML)
      }
      // Sized by a stylesheet alone, it has no size outside the page: write the one it is drawn at.
      if (!copy.hasAttribute('viewBox') && !copy.hasAttribute('width')) {
        copy.setAttribute('width', String(logo.w))
        copy.setAttribute('height', String(logo.h))
      }
      let svg = copy.outerHTML
      if (defs.length) svg = svg.replace(/<\/svg>\s*$/, `<defs>${defs.join('')}</defs></svg>`)
      if (svg.length <= SVG_MAX) logo.svg = svg
      logo.color = cs(logoEl).color
    }
  }

  // The bar the logo sits on: the first wide holder with a solid fill (a
  // gradient counts by its first stop). A see-through header shows the page
  // or a hero, a tall fill is a hero band holding the logo, a picture is a
  // photo: none of them is a bar. A cookie notice or an advert slot may push
  // it down the first screen.
  const BAR_MAX_HEIGHT = 240
  const header = ((): { bg: string; text?: string } | null => {
    if (!barFrom || barFrom.getBoundingClientRect().top >= NEAR_TOP) return null
    for (let at = barFrom.parentElement; at && at !== document.body; at = at.parentElement) {
      const s = cs(at)
      const image = s.backgroundImage || 'none'
      if (/url\(/.test(image)) return null
      const stop = /gradient\(/.test(image)
        ? /(?:rgba?|oklch|hsla?|oklab)\([^)]*\)/.exec(image)?.[0]
        : undefined
      const fill = solid(s.backgroundColor) ? s.backgroundColor : stop && solid(stop) ? stop : null
      const r = at.getBoundingClientRect()
      if (!fill || r.width < innerWidth * 0.5) continue
      if (r.height > BAR_MAX_HEIGHT) return null
      const inks = new Map<string, number>()
      for (const link of at.querySelectorAll('a, button')) {
        if (link.contains(barFrom) || !(link.textContent || '').trim()) continue
        const color = cs(link).color
        inks.set(color, (inks.get(color) || 0) + 1)
      }
      const text = [...inks].sort((a, b) => b[1] - a[1])[0]?.[0]
      return { bg: fill, ...(text ? { text } : {}) }
    }
    return null
  })()

  // A bot check's wall: a short page holding a challenge frame or asking to
  // prove a human. Only a short one: full pages carry invisible captchas on
  // their forms.
  const WALL_FRAME =
    /captcha-delivery|challenges\.cloudflare|hcaptcha|recaptcha|perimeterx|px-captcha|arkoselabs|funcaptcha/i
  const WALL_WORDS =
    /captcha|verify you are (a )?human|security check\b(?!list)|unusual traffic|are you a robot|just a moment|access denied|you have been blocked|request unsuccessful|attention required|pardon our interruption/i
  const pageWords = (document.body.innerText || document.body.textContent || '').trim()
  // The icons the page declares, for the app to fetch the best of: a site
  // that walls off the static reader still names them here.
  const sizeOf = (sizes: string | null) => {
    const side = /(\d+)x(\d+)/i.exec(sizes || '')
    return side ? Number(side[1]) : null
  }
  const icons = [
    ...document.querySelectorAll<HTMLLinkElement>(
      'link[rel~="icon" i], link[rel="apple-touch-icon" i], link[rel="apple-touch-icon-precomposed" i]'
    ),
  ]
    .filter((link) => link.href && /^https?:/.test(link.href))
    .slice(0, 20)
    .map((link) => ({
      url: link.href,
      size: sizeOf(link.getAttribute('sizes')),
      type: link.getAttribute('type') || null,
      from: (/apple-touch-icon/i.test(link.rel) ? 'apple-touch-icon' : 'icon') as
        'apple-touch-icon' | 'icon',
    }))

  const wall =
    pageWords.length < 2000 &&
    ([...document.querySelectorAll('iframe')].some((frame) => WALL_FRAME.test(frame.src || '')) ||
      WALL_WORDS.test(`${document.title} ${pageWords}`))

  return {
    title: document.title,
    themeColor: meta?.content || null,
    bg,
    text: body.color,
    bodyFont: body.fontFamily,
    h1: h1 ? { font: cs(h1).fontFamily } : null,
    buttons,
    candidates,
    surfaces,
    texts,
    borders,
    wall,
    icons,
    ...(textFont ? { textFont } : {}),
    ...(textColor ? { textColor } : {}),
    header,
    logo,
  }
}
