/**
 * The signs that say whether a rendered page is the site's own homepage or
 * something shown in its place (site/page-kind.ts decides): how many words
 * it shows and how they start, its first heading, and its links with their
 * words (a country picker is a list of countries). Read in a pass of its
 * own after the measurement.
 *
 * Self-contained, like the measurement: it is sent as its source text and
 * runs in the page, so it refers to nothing outside its own body.
 */
export interface PageSignsRead {
  /** The first visible heading's words. */
  heading: string
  /** How the page's visible text starts. */
  lead: string
  /** The length of the page's visible text, in characters. */
  words: number
  /** The page's links, in order: an absolute address and its words, cut short. */
  links: { href: string; text: string }[]
}

export function measurePageSigns(): PageSignsRead {
  const squash = (value: string) => value.replace(/\s+/g, ' ').trim()
  const text = squash(document.body?.innerText || document.body?.textContent || '')
  const shown = (el: Element) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const heading = [...document.querySelectorAll('h1, h2')].find(
    (el) => shown(el) && squash(el.textContent || '').length > 1
  )
  const links: PageSignsRead['links'] = []
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (links.length >= 150) break
    const href = link.href
    const words = squash(link.textContent || link.getAttribute('aria-label') || '')
    if (!/^https?:/.test(href) || !words || (link.getAttribute('href') || '').startsWith('#'))
      continue
    links.push({ href: href.slice(0, 2000), text: words.slice(0, 60) })
  }
  return {
    heading: squash(heading?.textContent || '').slice(0, 200),
    lead: text.slice(0, 1500),
    words: text.length,
    links,
  }
}
