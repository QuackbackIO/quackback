/**
 * A header that is a tall band. The measurement (page-measure.ts) takes the
 * bar the logo sits on only when it is a bar: up to 240px tall. Some sites
 * set the logo and the menu at the top of a taller block of one colour that
 * also holds the page's opening words, and that colour is their header's.
 *
 * It is taken only when it is plainly that, because a false header is worse
 * than a missing one: the first wide filled box round the logo, one solid
 * colour with no picture or gradient of its own (two shades of one colour
 * read as that colour), at the top of the page and
 * no taller than a screen, holding the menu on the logo's own row, and with
 * no photo, video, drawing or painted box covering a real share of it.
 *
 * A pass of its own after the measurement, which leaves the logo's element
 * for it. Self-contained: it is sent as its source text and runs in the page.
 */
export interface PageHeaderBand {
  bg: string
  text?: string
  tall: true
}

export function measureHeaderBand(): PageHeaderBand | null {
  const BAR_MAX_HEIGHT = 240
  const BAND_MAX_HEIGHT = 800
  const BAND_MAX_TOP = 300
  /** The menu's links sit this near the logo's own row. */
  const ROW_REACH = 120
  const MENU_LINKS = 3
  /** Media covering this share of the band makes it a hero, not a header. */
  const MEDIA_SHARE = 0.15
  const cs = (el: Element) => getComputedStyle(el)
  const solid = (c: string) => {
    if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return false
    const alpha = /(?:,|\/)\s*([\d.]+)(%?)\s*\)$/.exec(c)
    if (!alpha || (c.startsWith('rgb(') && !c.includes('/'))) return true
    return Number(alpha[1]) / (alpha[2] ? 100 : 1) >= 0.95
  }
  const painted = (el: Element) => {
    const image = cs(el).backgroundImage
    return Boolean(image) && image !== 'none'
  }
  const marks = (window as unknown as Record<symbol, { bar?: unknown } | undefined>)[
    Symbol.for('quackback.reader')
  ]
  const kept = marks?.bar
  if (!(kept instanceof Element)) return null
  /**
   * A gradient that is one colour to the eye: every stop a solid `rgb()` and
   * none far from the first in any channel. Its first stop, where the logo
   * sits, else null.
   */
  const SHADE = 40
  const plainGradient = (image: string): string | null => {
    if (!/^(?:linear|radial)-gradient\(/.test(image) || /url\(/.test(image)) return null
    const stops = image.match(/rgba?\([^)]*\)/g) || []
    if (stops.length < 2 || !stops.every(solid)) return null
    const channels = stops.map((stop) => (stop.match(/[\d.]+/g) || []).slice(0, 3).map(Number))
    const near = channels.every((c) => c.every((v, i) => Math.abs(v - channels[0]![i]!) <= SHADE))
    return near ? stops[0]! : null
  }
  const mark = kept.getBoundingClientRect()
  const MEDIA = /^(?:img|picture|video|canvas|iframe|svg|object|embed)$/i
  /** A band's one colour: a solid fill or a plain gradient, else null (a picture, a real gradient). */
  const fillOf = (el: Element): string | null => {
    const shade = painted(el) ? plainGradient(cs(el).backgroundImage) : null
    if (painted(el) && !shade) return null
    const fill = shade ?? cs(el).backgroundColor
    return solid(fill) ? fill : null
  }
  /** Whether no photo, video, drawing or painted box covers a real share of `band`, the logo's own boxes aside. */
  const clearOfMedia = (band: Element): boolean => {
    const r = band.getBoundingClientRect()
    const area = r.width * r.height
    let scanned = 0
    for (const el of band.querySelectorAll('*')) {
      if (scanned++ > 2500) return false
      if (el === kept || kept.contains(el) || el.contains(kept)) {
        // A box round the logo may be painted too: a layer over the whole band.
        if (el.contains(kept) && el !== kept && painted(el)) return false
        continue
      }
      if (!MEDIA.test(el.tagName) && !painted(el)) continue
      const box = el.getBoundingClientRect()
      if (box.width * box.height >= MEDIA_SHARE * area) return false
    }
    return true
  }
  /** The menu's ink on the logo's row within `scope`, or null when fewer than a menu's links sit there. */
  const menuInk = (scope: Element): { text?: string } | null => {
    const row = mark.top + mark.height / 2
    const inks = new Map<string, number>()
    let menu = 0
    for (const link of scope.querySelectorAll('a, button')) {
      if (link.contains(kept) || !(link.textContent || '').trim()) continue
      const box = link.getBoundingClientRect()
      if (box.width === 0 || Math.abs(box.top + box.height / 2 - row) > ROW_REACH) continue
      menu++
      const color = cs(link).color
      inks.set(color, (inks.get(color) || 0) + 1)
    }
    if (menu < MENU_LINKS) return null
    const text = [...inks].sort((a, b) => b[1] - a[1])[0]?.[0]
    return text ? { text } : {}
  }
  const isBand = (r: DOMRect) =>
    r.width >= innerWidth * 0.5 && r.height <= BAND_MAX_HEIGHT && r.top <= BAND_MAX_TOP

  // The band the logo and the menu sit in. The bar is the outermost
  // bar-shaped box round the logo: the header, not the logo's own link.
  let bar: Element | null = null
  let pastBar = false
  for (let at = kept.parentElement; at && at !== document.body; at = at.parentElement) {
    const r = at.getBoundingClientRect()
    if (r.height > BAR_MAX_HEIGHT) pastBar = true
    else if (!pastBar && r.width >= innerWidth * 0.5) bar = at
    if (painted(at) && !plainGradient(cs(at).backgroundImage)) return null
    const fill = fillOf(at)
    if (!fill || r.width < innerWidth * 0.5) continue
    // An ordinary bar is the measurement's to take, and it did or would not.
    if (r.height <= BAR_MAX_HEIGHT) return null
    if (!isBand(r) || !clearOfMedia(at)) return null
    const ink = menuInk(at)
    return ink ? { bg: fill, ...ink, tall: true } : null
  }

  // A see-through bar laid over the band below it (a header placed over the
  // page's opening block): the band behind the bar is what a visitor sees as
  // the header. Taken by the same rules, from the block that lies under the
  // middle of the bar and is no part of it, the smallest such block winning.
  if (!bar) return null
  const barBox = bar.getBoundingClientRect()
  const middle = barBox.top + barBox.height / 2
  let behind: { el: Element; fill: string; area: number } | null = null
  let scanned = 0
  for (const el of document.body.querySelectorAll('*')) {
    if (scanned++ > 2500) break
    if (el === bar || bar.contains(el) || el.contains(bar)) continue
    const r = el.getBoundingClientRect()
    if (r.top > middle || r.top + r.height < middle || r.height <= BAR_MAX_HEIGHT) continue
    if (!isBand(r)) continue
    const fill = fillOf(el)
    if (!fill) continue
    const area = r.width * r.height
    if (!behind || area < behind.area) behind = { el, fill, area }
  }
  if (!behind || !clearOfMedia(behind.el)) return null
  const ink = menuInk(bar)
  return ink ? { bg: behind.fill, ...ink, tall: true } : null
}
