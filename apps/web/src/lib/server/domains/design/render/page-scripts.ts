/**
 * Scripts a rendered read runs inside the page. Each is self-contained: it is
 * sent as its source text and runs in the page, so it refers to nothing
 * outside its own body.
 */

/** A rendered text role: its type as the page sets it, colours as CSS gives them. */
export interface PageType {
  family: string
  size: number
  weight: number
  /** In em. */
  tracking: number
  /** As a multiple of the size. */
  leading: number
  transform: string
  colour: string
}

/** A rendered box: a button, card or field. */
export interface PageBox {
  fill: string
  ink: string
  radius: number
  height: number
  borderWidth: number
  shadow: boolean
  weight: number
  transform: string
  text: string
}

export interface PageMeasure {
  title: string
  page: string
  headline: PageType | null
  heading: PageType | null
  body: PageType | null
  button: PageBox | null
  /** The button was chosen for its words: the page's main call to action. */
  action: boolean
  card: PageBox | null
  field: PageBox | null
  /** Opaque colours the top of the page is painted in, the largest area first. */
  palette: Array<{ colour: string; share: number }>
  /** The hero's fill, when a colour other than the page's fills most of it. */
  hero: string | null
}

/**
 * Declines optional cookies where a notice offers it, as a visitor would.
 * Returns whether it found a button to press.
 */
export function declineConsent(): boolean {
  const words =
    /^(decline|reject|refuse|deny)( all| optional)?( cookies)?$|^(use |accept )?(only |strictly )?(necessary|essential|required)( cookies)?( only)?$|^no,? thanks$/i
  const seen = (el: Element) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  const button = [...document.querySelectorAll('button, [role=button], a, input[type=button]')]
    .filter(seen)
    .find((el) =>
      words.test(
        ((el as HTMLInputElement).value || el.textContent || '').trim().replace(/\s+/g, ' ')
      )
    )
  if (!button) return false
  ;(button as HTMLElement).click()
  return true
}

/**
 * Hides what is left over the page once a notice is answered: consent
 * notices that offer no way to decline, and dimming layers over the page.
 * Returns how many it hid.
 */
export function hideOverlays(): number {
  const notice = /(cookie|consent|privacy|gdpr|tracking)/i
  let hidden = 0
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue
    const r = el.getBoundingClientRect()
    const covers = (r.width * r.height) / (innerWidth * innerHeight)
    const dims = /rgba\(.+,\s*0?\.\d+\)$/.test(cs.backgroundColor) && covers > 0.5
    const tag = `${el.id} ${typeof el.className === 'string' ? el.className : ''} ${el.getAttribute('aria-label') ?? ''}`
    const isNotice =
      (notice.test(tag) || (covers < 0.6 && notice.test((el.textContent || '').slice(0, 600)))) &&
      cs.position === 'fixed'
    if (dims || isNotice) {
      ;(el as HTMLElement).style.setProperty('display', 'none', 'important')
      hidden++
    }
  }
  document.documentElement.style.setProperty('overflow', 'auto', 'important')
  document.body.style.setProperty('overflow', 'auto', 'important')
  return hidden
}

/** The page's type, colours and shapes by role, as it renders. */
export function measurePage(): PageMeasure {
  const FOLD = 1000
  const TOP = 1800
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return (
      r.width > 4 &&
      r.height > 4 &&
      r.bottom > 0 &&
      r.top < 2400 &&
      cs.visibility !== 'hidden' &&
      cs.display !== 'none' &&
      Number(cs.opacity) > 0.1
    )
  }
  const words = (el: Element) => (el.textContent || '').trim().replace(/\s+/g, ' ')
  const opaque = (c: string) => {
    if (c === 'transparent') return false
    const alpha = /rgba?\([^)]*,\s*([\d.]+)\)$/.exec(c)
    return !alpha || Number(alpha[1]) >= 0.9
  }
  const typeOf = (el: Element | undefined): PageType | null => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const size = parseFloat(cs.fontSize)
    return {
      family: cs.fontFamily,
      size,
      weight: Number(cs.fontWeight) || 400,
      tracking: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) / size,
      leading: cs.lineHeight === 'normal' ? 1.2 : parseFloat(cs.lineHeight) / size,
      transform: cs.textTransform,
      colour: cs.color,
    }
  }
  const boxOf = (el: Element | undefined): PageBox | null => {
    if (!el) return null
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    const radius = parseFloat(cs.borderTopLeftRadius) || 0
    return {
      fill: cs.backgroundColor,
      ink: cs.color,
      radius: radius >= r.height / 2 - 1 && radius > 0 ? 999 : radius,
      height: r.height,
      borderWidth: parseFloat(cs.borderTopWidth) || 0,
      shadow: cs.boxShadow !== 'none',
      weight: Number(cs.fontWeight) || 400,
      transform: cs.textTransform,
      text: words(el).slice(0, 40),
    }
  }
  const all = (selector: string) => [...document.querySelectorAll(selector)].filter(visible)
  const bodyBg = getComputedStyle(document.body).backgroundColor
  const page = opaque(bodyBg) ? bodyBg : getComputedStyle(document.documentElement).backgroundColor

  // The headline: the h1 unless much larger display text above the fold leads instead.
  const texts = all('h1, h2, h3, p, span, div, a, strong').filter(
    (el) =>
      words(el).length > 6 &&
      el.getBoundingClientRect().top < FOLD &&
      [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 2)
  )
  const size = (el: Element) => parseFloat(getComputedStyle(el).fontSize)
  const largest = texts.sort((a, b) => size(b) - size(a))[0]
  const h1 = all('h1').find((el) => words(el).length > 2)
  const headline = h1 && (!largest || size(h1) >= size(largest) * 0.7) ? h1 : largest
  const headSize = headline ? size(headline) : 0
  const heading = all('h2, h3').find((h) => size(h) < headSize * 0.95 && words(h).length > 3)
  const body = all('p').find((p) => words(p).length > 60 && size(p) <= 20)

  // The main button: a filled control near the top, its words asking visitors to act first.
  const cta =
    /^(get( \w+)?( started| free| the app| a demo| \w+ free)?|start\b|sign ?up|try\b|join\b|buy\b|shop\b|book\b|send\b|download\b|request\b|contact sales|create\b|open (an )?account|subscribe\b)/i
  const notice = /(accept|reject|decline|cookie|consent|preferences|customi[sz]e|skip to)/i
  const signIn = /^(log ?in|sign ?in|my account)$/i
  const buttons = all('a, button, [role=button], input[type=submit]').filter((el) => {
    const text = words(el)
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return (
      text.length > 1 &&
      text.length < 32 &&
      !notice.test(text) &&
      r.left >= 0 &&
      r.top < 1400 &&
      r.height >= 28 &&
      opaque(cs.backgroundColor) &&
      cs.backgroundColor !== page
    )
  })
  const rank = (el: Element) =>
    (cta.test(words(el)) ? 3 : 0) +
    (el.getBoundingClientRect().top < 900 ? 1 : 0) -
    (signIn.test(words(el)) ? 3 : 0)
  const button = buttons
    .map((el, order) => ({ el, order, score: rank(el) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)[0]

  const card = all('div, article, section, li, a').find((el) => {
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return (
      r.width > 180 &&
      r.height > 100 &&
      r.width < 900 &&
      parseFloat(cs.borderTopLeftRadius) > 0 &&
      (cs.boxShadow !== 'none' ||
        parseFloat(cs.borderTopWidth) > 0 ||
        (opaque(cs.backgroundColor) && cs.backgroundColor !== page))
    )
  })
  const field = all('input[type=text], input[type=search], input[type=email], input:not([type])')[0]

  // Painted area by colour over the top of the page: each element's own
  // background, less what its painted children cover, clipped to the screen.
  const areas = new Map<string, number>()
  const clipped = (r: DOMRect) =>
    Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) *
    Math.max(0, Math.min(r.bottom, TOP) - Math.max(r.top, 0))
  const painted = [...document.querySelectorAll('body, body *')]
    .slice(0, 4000)
    .filter((el) => visible(el) && opaque(getComputedStyle(el).backgroundColor))
  // Each painted element covers part of the nearest painted element it sits in.
  const paintedSet = new Set(painted)
  const covered = new Map<Element, number>()
  for (const el of painted) {
    let above = el.parentElement
    while (above && !paintedSet.has(above)) above = above.parentElement
    if (above) covered.set(above, (covered.get(above) ?? 0) + clipped(el.getBoundingClientRect()))
  }
  for (const el of painted) {
    const area = Math.max(0, clipped(el.getBoundingClientRect()) - (covered.get(el) ?? 0))
    if (!area) continue
    const colour = getComputedStyle(el).backgroundColor
    areas.set(colour, (areas.get(colour) ?? 0) + area)
  }
  // Shares of the painted area: layers can overlap, so the screen's size is not the whole.
  const total = [...areas.values()].reduce((sum, area) => sum + area, 0) || 1
  const palette = [...areas]
    .map(([colour, area]) => ({ colour, share: area / total }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 8)

  // The hero's fill: the colour most of the first screen is painted, when it is not the page's.
  const hero =
    [...document.querySelectorAll('body *')]
      .slice(0, 1500)
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return (
          visible(el) &&
          r.top < 200 &&
          r.width >= innerWidth * 0.9 &&
          r.height >= 300 &&
          opaque(cs.backgroundColor) &&
          cs.backgroundColor !== page
        )
      })
      .map((el) => getComputedStyle(el).backgroundColor)[0] ?? null

  return {
    title: document.title,
    page,
    headline: typeOf(headline),
    heading: typeOf(heading),
    body: typeOf(body),
    button: boxOf(button?.el),
    action: !!button && button.score >= 3,
    card: boxOf(card),
    field: boxOf(field),
    palette,
    hero,
  }
}
