/**
 * The drawn preview's fingerprint, read in the builder from the canvas's
 * same-origin frame: the computed styles of the portal's parts by the rig's
 * roles (headline, section heading, body, nav link, primary button, card,
 * field, page background), found by the same selectors the rig's
 * fingerprint uses on a portal, so a score here means what it means there.
 */
import type { BoxStyle, Fingerprint, TypeStyle } from '@/lib/shared/design/fingerprint'

const TRANSPARENT = new Set(['rgba(0, 0, 0, 0)', 'transparent'])
const opaque = (c: string) => !TRANSPARENT.has(c)

export function readFingerprint(doc: Document): Fingerprint {
  const win = doc.defaultView
  if (!win) return {}
  const style = (el: Element) => win.getComputedStyle(el)
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    const cs = style(el)
    return (
      r.width > 4 &&
      r.height > 4 &&
      r.top < 2400 &&
      cs.visibility !== 'hidden' &&
      cs.display !== 'none' &&
      Number(cs.opacity) > 0.1
    )
  }
  const text = (el: Element) => (el.textContent || '').trim()
  const all = (sel: string) => [...doc.querySelectorAll(sel)].filter(visible)

  const typo = (el: Element | undefined): TypeStyle | null => {
    if (!el) return null
    const cs = style(el)
    const size = parseFloat(cs.fontSize)
    return {
      family: cs.fontFamily,
      size,
      weight: Number(cs.fontWeight),
      tracking: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) / size,
      leading: cs.lineHeight === 'normal' ? 1.2 : parseFloat(cs.lineHeight) / size,
      transform: cs.textTransform,
      color: cs.color,
    }
  }
  const box = (el: Element | undefined): BoxStyle | null => {
    if (!el) return null
    const cs = style(el)
    const r = el.getBoundingClientRect()
    const radius = parseFloat(cs.borderTopLeftRadius)
    return {
      bg: cs.backgroundColor,
      color: cs.color,
      // Corners as round as half the height read as fully round, as the rig reads them.
      radius: radius >= 999 || (radius > 0 && radius >= r.height / 2 - 1) ? 999 : radius,
      height: r.height,
      borderWidth: parseFloat(cs.borderTopWidth),
      borderColor: cs.borderTopColor,
      shadow: cs.boxShadow !== 'none',
      size: parseFloat(cs.fontSize),
      weight: Number(cs.fontWeight),
      transform: cs.textTransform,
      family: cs.fontFamily,
      padX: parseFloat(cs.paddingLeft),
    }
  }

  const button = all('[data-slot=button][data-variant=default], [data-qb-part=composer] button')[0]
  const bodyBg = doc.body ? style(doc.body).backgroundColor : 'transparent'
  const htmlBg = style(doc.documentElement).backgroundColor
  return {
    page: opaque(bodyBg) ? bodyBg : htmlBg,
    headline: typo(all('[data-qb-part=headline]')[0]),
    heading: typo(all('main h2, [data-qb-section] h2, h2')[0]),
    body: typo(all('main p, p').find((p) => text(p).length > 40)),
    button: box(button),
    buttonText: button ? text(button).slice(0, 30) : null,
    link: typo(all('[data-qb-part=nav-item]')[0]),
    card: box(all('[data-qb-surface=card]')[0]),
    field: box(all('[data-qb-part=composer], [data-qb-part=search-field], input[type=text]')[0]),
  }
}

const sameReading = (a: Fingerprint, b: Fingerprint) => JSON.stringify(a) === JSON.stringify(b)

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/**
 * Reads the frame once it has settled after a change: its fonts loaded and
 * two readings a beat apart alike. With `before`, waits (up to `most`) for
 * the reading to move from it first, as a change reaches the frame by
 * message and draws a moment later.
 */
export async function readSettled(
  frame: () => HTMLIFrameElement | null,
  {
    before,
    least = 250,
    most = 2500,
    beat = 150,
  }: { before?: Fingerprint; least?: number; most?: number; beat?: number } = {}
): Promise<Fingerprint> {
  const began = Date.now()
  const read = async () => {
    const doc = frame()?.contentDocument
    if (!doc) throw new Error('The preview is not there to read.')
    await doc.fonts?.ready
    return readFingerprint(doc)
  }
  await pause(least)
  let last = await read()
  while (Date.now() - began < most) {
    await pause(beat)
    const next = await read()
    const moved = !before || !sameReading(next, before)
    if (moved && sameReading(next, last)) return next
    last = next
  }
  return last
}
