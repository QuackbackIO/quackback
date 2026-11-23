/**
 * What a rendered page says beside its measurement (page-measure.ts), read
 * in a second pass so that function stays as it is: the name the site
 * declares for itself, and how its cards stand off the page.
 *
 * - The name: `og:site_name`, else the name its JSON-LD gives its
 *   Organization, Corporation or Brand (a @graph and a publisher included).
 * - The cards: the words on each card, tallied by the card's look. A card is
 *   a filled box narrower than the page and large enough to hold a few lines
 *   (a link may be one; a button is not);
 *   a real drop shadow is its look whatever hairline goes with it, an edge
 *   with at most a whisper of shadow is a border, and a rounded fill alone
 *   is flat when it is not the page's own colour (its fills are listed, so
 *   the reader can leave out one too near the page to show). Boxes in a cookie banner,
 *   a dialog or a fixed layer are not the site's cards.
 *
 * Self-contained, like the measurement: it is sent as its source text and
 * runs in the page, so it refers to nothing outside its own body.
 */
export interface PageExtras {
  siteName: string | null
  /** Every name the page declares, most trusted first: the site's, its organisation's, its app's. */
  names?: string[]
  /** The site's own word (`label`) as the page's text writes it, when it does. */
  nameWritten?: string | null
  /**
   * The smallest size, in CSS px, the page draws the headings face at
   * (`headingStack`'s first family), wherever it has words in it. Null when
   * no words are set in it.
   */
  headingMinPx?: number | null
  /** What the logo the measurement took is labelled: its alt text, its title or its link's label. */
  logoLabel?: string | null
  cards: {
    border: number
    shadow: number
    flat: number
    /** The flat cards' fills, most words first: whether each stands off the page is the reader's to judge. */
    flats: { bg: string; chars: number }[]
  }
}

export function measurePageExtras(label?: string, headingStack?: string): PageExtras {
  const cs = (el: Element) => getComputedStyle(el)
  const isTransparent = (c: string) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'
  /** See-through, or nearly: no fill to speak of. */
  const faint = (c: string) => {
    if (isTransparent(c)) return true
    const alpha = /(?:,|\/)\s*([\d.]+)(%?)\s*\)$/.exec(c)
    if (!alpha || (c.startsWith('rgb(') && !c.includes('/'))) return false
    return Number(alpha[1]) / (alpha[2] ? 100 : 1) < 0.5
  }

  // ---- The declared name ----
  const ORGANISATION = /^(?:organization|corporation|brand|\w*organization)$/i
  const organisationName = (node: unknown, depth: number): string | null => {
    if (depth > 6 || !node || typeof node !== 'object') return null
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = organisationName(item, depth + 1)
        if (found) return found
      }
      return null
    }
    const record = node as Record<string, unknown>
    const types = ([] as unknown[]).concat(record['@type'] ?? [])
    const name = typeof record.name === 'string' ? record.name.replace(/\s+/g, ' ').trim() : ''
    if (name && types.some((t) => typeof t === 'string' && ORGANISATION.test(t))) return name
    return (
      organisationName(record['@graph'], depth + 1) ?? organisationName(record.publisher, depth + 1)
    )
  }
  const metaName = (selector: string): string | null =>
    document
      .querySelector<HTMLMetaElement>(selector)
      ?.content?.replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200) || null
  const jsonLdName = (): string | null => {
    const blocks = [...document.querySelectorAll('script[type="application/ld+json" i]')]
    for (const block of blocks.slice(0, 8)) {
      try {
        const found = organisationName(JSON.parse(block.textContent || ''), 0)
        if (found) return found.slice(0, 200)
      } catch {
        // A malformed block says nothing.
      }
    }
    return null
  }
  const declared = [
    metaName('meta[property="og:site_name" i]'),
    jsonLdName(),
    metaName('meta[name="application-name" i]'),
    metaName('meta[name="apple-mobile-web-app-title" i]'),
  ].filter((name): name is string => Boolean(name))
  const names = declared.filter((name, index) => declared.indexOf(name) === index)
  // The logo the measurement took (page-measure.ts leaves it here), by its label.
  const logoEl = (window as unknown as Record<symbol, { logo?: unknown } | undefined>)[
    Symbol.for('quackback.reader')
  ]?.logo
  const logoLabel =
    logoEl instanceof Element
      ? ([
          logoEl.getAttribute('alt'),
          logoEl.getAttribute('aria-label'),
          logoEl.querySelector('title')?.textContent,
          logoEl.closest('a[href]')?.getAttribute('aria-label'),
        ]
          .map((label) => (label || '').replace(/\s+/g, ' ').trim())
          .find((label) => label.length > 1)
          ?.replace(/\s+(?:logo|home(?:\s?page)?)$/i, '')
          .slice(0, 200) ?? null)
      : null

  // ---- The domain's own word, as the page writes it ----
  // `northwindexpress` is Northwind Express: the spelling the page uses most,
  // an all lower-case run (an address) never among them.
  const writtenAs = (text: string, word: string): string | null => {
    const chars = [...word].filter((c) => /[\p{L}\p{N}]/u.test(c))
    if (chars.length < 3) return null
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${chars.join("[ \\-'’]?")}(?![\\p{L}\\p{N}])`,
      'giu'
    )
    const counts = new Map<string, number>()
    for (const match of text.slice(0, 200_000).matchAll(pattern)) {
      const written = match[0].replace(/\s+/g, ' ')
      if (written === written.toLowerCase()) continue
      counts.set(written, (counts.get(written) || 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  }
  const nameWritten = label
    ? writtenAs(
        `${document.title} ${document.body.innerText || document.body.textContent || ''}`,
        label
      )
    : null

  // ---- The sizes the headings face is drawn at ----
  // A display face is set only large; a headings face is on small titles too.
  const firstFamily = (stack: string) =>
    (stack.match(/"[^"]*"|'[^']*'|[^,]+/)?.[0] || '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .toLowerCase()
  const headingFamily = headingStack ? firstFamily(headingStack) : ''
  let headingMinPx: number | null = null
  if (headingFamily) {
    let seen = 0
    for (const el of document.body.querySelectorAll('*')) {
      if (seen++ > 4000) break
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
      let own = 0
      for (const node of el.childNodes)
        if (node.nodeType === 3) own += (node.textContent || '').trim().length
      if (own < 2) continue
      const s = cs(el)
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || s.visibility === 'hidden' || s.display === 'none')
        continue
      if (firstFamily(s.fontFamily) !== headingFamily) continue
      const size = parseFloat(s.fontSize)
      if (size > 0 && (headingMinPx === null || size < headingMinPx)) headingMinPx = size
    }
  }

  // ---- The cards ----
  const body = cs(document.body)
  const page = isTransparent(body.backgroundColor)
    ? cs(document.documentElement).backgroundColor
    : body.backgroundColor
  /**
   * A computed box-shadow's layers: a hairline ring (no blur, no offset, a
   * spread of a pixel or so) is an edge; a layer with a blur or an offset
   * lifts the box, and one with a real blur drops a shadow. Inset and
   * see-through layers are none of these.
   */
  const shadowLayers = (value: string) => {
    if (!value || value === 'none') return []
    return value.split(/,(?![^(]*\))/).flatMap((layer) => {
      if (/\binset\b/.test(layer)) return []
      const colour = /(?:rgba?|hsla?|oklch|oklab|color)\([^)]*\)|#[\da-f]{3,8}\b/i.exec(layer)?.[0]
      if (colour && isTransparent(colour)) return []
      const lengths = (layer.replace(colour || '', '').match(/-?[\d.]+(?:px)?/g) || []).map(
        (n) => parseFloat(n) || 0
      )
      const [x = 0, y = 0, blur = 0, spread = 0] = lengths
      const ring = x === 0 && y === 0 && blur === 0 && spread > 0 && spread <= 2
      const lifts = !ring && (blur > 0 || x !== 0 || y !== 0)
      return [{ ring, lifts, drops: lifts && blur >= 6 }]
    })
  }
  const LAYER = /cookie|consent|gdpr|onetrust|cookiebot|didomi|usercentrics/i
  /** In a cookie banner, a dialog or a fixed layer: not one of the site's cards. */
  const layered = (el: Element) => {
    for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
      if (LAYER.test(`${at.id} ${at.getAttribute('class') || ''}`)) return true
      if (at.tagName === 'DIALOG' || at.getAttribute('role') === 'dialog') return true
      const position = cs(at).position
      if (position === 'fixed' || position === 'sticky') return true
    }
    return false
  }
  /**
   * The filled box an element's words sit on, or null on the page, a photo
   * or a button. A card that is one link is still a card.
   */
  const boxOf = (el: Element): Element | null => {
    for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
      const s = cs(at)
      if (s.backgroundImage && s.backgroundImage !== 'none') return null
      if (!faint(s.backgroundColor)) return at.closest('button') ? null : at
    }
    return null
  }
  const lookOf = (box: Element): 'border' | 'shadow' | 'flat' | null => {
    const r = box.getBoundingClientRect()
    if (r.width >= 0.9 * window.innerWidth || r.width < 160 || r.height < 80) return null
    const b = cs(box)
    const layers = shadowLayers(b.boxShadow)
    const edged =
      ((parseFloat(b.borderTopWidth) || 0) >= 1 &&
        b.borderTopStyle !== 'none' &&
        !isTransparent(b.borderTopColor)) ||
      layers.some((layer) => layer.ring)
    if (layers.some((layer) => layer.drops)) return 'shadow'
    if (edged) return 'border'
    if (layers.some((layer) => layer.lifts)) return 'shadow'
    const rounded = (parseFloat(b.borderTopLeftRadius) || 0) > 0
    return rounded && b.backgroundColor !== page ? 'flat' : null
  }
  const cards = { border: 0, shadow: 0, flat: 0 }
  const flatFills = new Map<string, number>()
  const looks = new Map<Element, 'border' | 'shadow' | 'flat' | null>()
  let scanned = 0
  for (const el of document.body.querySelectorAll('*')) {
    if (scanned++ > 4000) break
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
    let own = 0
    for (const node of el.childNodes)
      if (node.nodeType === 3) own += (node.textContent || '').trim().length
    if (own < 2) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.top > 1400 || cs(el).visibility === 'hidden') continue
    const box = boxOf(el)
    if (!box) continue
    if (!looks.has(box)) looks.set(box, layered(box) ? null : lookOf(box))
    const look = looks.get(box)
    if (!look) continue
    cards[look] += own
    if (look === 'flat') {
      const fill = cs(box).backgroundColor
      flatFills.set(fill, (flatFills.get(fill) || 0) + own)
    }
  }
  const flats = [...flatFills]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([bg, chars]) => ({ bg, chars }))

  return {
    siteName: names[0] ?? null,
    names,
    nameWritten,
    logoLabel,
    headingMinPx,
    cards: { ...cards, flats },
  }
}
