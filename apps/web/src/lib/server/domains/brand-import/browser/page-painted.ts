/**
 * Two things a page paints where the measurement (page-measure.ts) does not
 * look. Each is a pass of its own and self-contained: it is sent as its source
 * text and runs in the page.
 *
 * The page's fill, when neither the body nor the root paints one: a wrapper
 * in the page's own flow that runs its whole length and width, is filled
 * solid and holds nearly all its words. A hero band, a fixed backdrop, a
 * scrim or a notice is none of these. Run before the measurement, which
 * reads the box it marks.
 *
 * The logo, when no image was one: a drawing painted on the header's home
 * link as a background picture or a mask. A sprite sheet, a photo or a
 * gradient is no logo. Run after the measurement, which leaves the link.
 */
import type { PageLogo } from './page-measure.types'

/** Marks the page-long wrapper for the measurement. True when the page has one. */
export function markPageWrapper(): boolean {
  const store = window as unknown as Record<symbol, unknown>
  const key = Symbol.for('quackback.page')
  delete store[key]
  const cs = (el: Element) => getComputedStyle(el)
  const clear = (c: string) => !c || c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
  const solid = (c: string) => {
    if (clear(c)) return false
    const alpha = /(?:,|\/)\s*([\d.]+)(%?)\s*\)$/.exec(c)
    if (!alpha || (c.startsWith('rgb(') && !c.includes('/'))) return true
    return Number(alpha[1]) / (alpha[2] ? 100 : 1) >= 0.95
  }
  const pictured = (s: CSSStyleDeclaration) =>
    Boolean(s.backgroundImage) && s.backgroundImage !== 'none'
  const [body, root] = [cs(document.body), cs(document.documentElement)]
  // A body or root that paints, in a colour or a picture, is its own answer.
  if (!clear(body.backgroundColor) || !clear(root.backgroundColor)) return false
  if (pictured(body) || pictured(root)) return false
  const pageHeight = Math.max(
    document.documentElement.scrollHeight || 0,
    document.body.scrollHeight || 0,
    window.innerHeight || 0
  )
  const wordsIn = (el: Element) =>
    ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().length
  const pageWords = wordsIn(document.body)
  if (pageWords === 0) return false
  let looked = 0
  for (const el of document.body.querySelectorAll('div, main, section, article')) {
    if (looked++ > 400) break
    const r = el.getBoundingClientRect()
    if (r.width < 0.9 * window.innerWidth || r.height < 0.9 * pageHeight) continue
    const s = cs(el)
    if (!solid(s.backgroundColor) || pictured(s)) continue
    if (s.position === 'fixed' || s.position === 'sticky' || Number(s.opacity) < 0.95) continue
    if (s.visibility === 'hidden' || s.display === 'none') continue
    if (wordsIn(el) < 0.8 * pageWords) continue
    store[key] = el
    return true
  }
  return false
}

/** The drawing painted on the header's home link, as the logo. Null when there is none. */
export function findPaintedLogo(): PageLogo | null {
  const kept = (window as unknown as Record<symbol, { logo?: Element; bar?: Element } | undefined>)[
    Symbol.for('quackback.reader')
  ]
  const link = kept?.bar
  if (!link || kept?.logo || link.tagName !== 'A') return null
  const r = link.getBoundingClientRect()
  if (r.width < 12 || r.height < 12 || r.width > 800 || r.height > 200) return null
  const ONE_DRAWING = /^url\(["']?([^"')]+\.svg(?:\?[^"')]*)?)["']?\)$/i
  const styles = [
    getComputedStyle(link),
    getComputedStyle(link, '::before'),
    getComputedStyle(link, '::after'),
  ]
  for (const s of styles) {
    for (const image of [
      s.backgroundImage,
      s.getPropertyValue('mask-image'),
      s.getPropertyValue('-webkit-mask-image'),
    ]) {
      const file = ONE_DRAWING.exec((image || '').trim())?.[1]
      if (!file || file.startsWith('data:')) continue
      try {
        const src = new URL(file, location.href).href
        if (/^https?:/.test(src))
          return { tag: 'IMG', src, w: Math.round(r.width), h: Math.round(r.height) }
      } catch {
        // Not an address.
      }
    }
  }
  return null
}
