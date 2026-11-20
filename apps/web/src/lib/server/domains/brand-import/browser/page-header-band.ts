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
  for (let at = kept.parentElement; at && at !== document.body; at = at.parentElement) {
    const shade = painted(at) ? plainGradient(cs(at).backgroundImage) : null
    if (painted(at) && !shade) return null
    const fill = shade ?? cs(at).backgroundColor
    const r = at.getBoundingClientRect()
    if (!solid(fill) || r.width < innerWidth * 0.5) continue
    // An ordinary bar is the measurement's to take, and it did or would not.
    if (r.height <= BAR_MAX_HEIGHT) return null
    if (r.height > BAND_MAX_HEIGHT || r.top > BAND_MAX_TOP) return null
    const area = r.width * r.height
    let scanned = 0
    for (const el of at.querySelectorAll('*')) {
      if (scanned++ > 2500) return null
      if (el === kept || kept.contains(el) || el.contains(kept)) {
        // A box round the logo may be painted too: a layer over the whole band.
        if (el.contains(kept) && el !== kept && painted(el)) return null
        continue
      }
      const media = /^(?:img|picture|video|canvas|iframe|svg|object|embed)$/i.test(el.tagName)
      if (!media && !painted(el)) continue
      const box = el.getBoundingClientRect()
      if (box.width * box.height >= MEDIA_SHARE * area) return null
    }
    const row = mark.top + mark.height / 2
    const inks = new Map<string, number>()
    let menu = 0
    for (const link of at.querySelectorAll('a, button')) {
      if (link.contains(kept) || !(link.textContent || '').trim()) continue
      const box = link.getBoundingClientRect()
      if (box.width === 0 || Math.abs(box.top + box.height / 2 - row) > ROW_REACH) continue
      menu++
      const color = cs(link).color
      inks.set(color, (inks.get(color) || 0) + 1)
    }
    if (menu < MENU_LINKS) return null
    const text = [...inks].sort((a, b) => b[1] - a[1])[0]?.[0]
    return { bg: fill, ...(text ? { text } : {}), tall: true }
  }
  return null
}
