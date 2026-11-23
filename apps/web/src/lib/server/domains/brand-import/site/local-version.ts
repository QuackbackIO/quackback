/**
 * A homepage that is a country or language picker (ikea.com's global page)
 * rather than the brand's own: it names its local versions with hreflang
 * links, and a visitor's browser is sent to one. Import reads the version for
 * the admin's own language, as their browser would have shown them.
 */

export interface LocalVersion {
  /** The hreflang, lowercased (en-gb, de, x-default). */
  lang: string
  url: string
}

/**
 * The local version for the first of `languages` the site offers: the exact
 * language and region, else that language in any region. Null when it offers
 * none of them.
 */
export function localVersion(versions: LocalVersion[], languages: string[]): string | null {
  const offered = versions.filter((version) => version.lang !== 'x-default')
  for (const wanted of languages) {
    const exact = offered.find((version) => version.lang === wanted)
    if (exact) return exact.url
    const base = wanted.split('-')[0]!
    const near = offered.find(
      (version) => version.lang === base || version.lang.startsWith(`${base}-`)
    )
    if (near) return near.url
  }
  return null
}

/** An Accept-Language header as lowercased tags, most wanted first. */
export function acceptLanguages(header: string | null | undefined): string[] {
  if (!header) return []
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find(Boolean)
      return { tag: (tag ?? '').trim().toLowerCase(), q: q ? Number(q) : 1, index }
    })
    .filter((entry) => /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(entry.tag))
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((entry) => entry.tag)
    .slice(0, 6)
}
