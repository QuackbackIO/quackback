/**
 * The name a site goes by, out of everything it says about itself: the site
 * name it declares, its organisation's, its app's, its logo's label and its
 * title. Every source is held to one test: the name must spell the site's
 * own domain. A site's declared name is as often a strapline ("Love your
 * bank"), a greeting ("Official Acme Site") or a nickname as its name, and a
 * name that does not spell the domain cannot be told from those. When no
 * source passes, the domain itself is the name.
 */

const MAX_NAME_CHARS = 100
/** A source part of more words than this is a sentence, not a name. */
const MAX_NAME_WORDS = 3
/** Words that greet the visitor or name the page rather than the brand. */
const PAGE_WORD = /^(?:welcome|official|home|homepage|page|site|website|index|start|main)$/i
/** A country after the name: the local site's, not part of the name. */
const COUNTRY = /\s+\(?(?:UK|US|USA|EU|GB|DE|FR|ES|IT|NL|CA|AU|IE|IN|JP|BR|MX)\)?$/
/** Second-level labels that belong to the ending (`co.uk`), when a label stands before them. */
const ENDING_LABELS = new Set([
  'co',
  'com',
  'org',
  'net',
  'ac',
  'edu',
  'gov',
  'govt',
  'gouv',
  'gob',
  'mil',
  'or',
  'ne',
  'go',
])
/** Words initials may leave out: Institute of Technology. */
const SMALL_WORD = /^(?:of|the|for|and|de|la|du|des|der|und)$/i

/** A word that opens a name as part of it: The Courier, Le Monde. */
const ARTICLE = /^(?:the|le|la|les|el|los|las|il|lo|die|der|das|de|het|o|os|a|as)$/i

const letters = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const trimmed = (value: string) => value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

interface Site {
  /** The host without `www.`. */
  host: string
  /** Every label short of the ending, run together: `bbcco` of bbc.co.uk. */
  all: string
  /** The site's own label: `acme` of docs.acme.co.uk. */
  label: string
}

function siteOf(siteUrl: string): Site | null {
  let host: string
  try {
    host = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
  const labels = host.split('.')
  const own = labels.length > 1 ? labels.slice(0, -1) : labels
  const named = own.length > 1 ? own.filter((label) => !ENDING_LABELS.has(label)) : own
  const label = letters(named.at(-1) ?? own.at(-1) ?? '')
  return label ? { host, all: letters(own.join('')), label } : null
}

/** A word of the domain: the site's label, three letters or more of it, or the label and more (`ACME.COM`). */
function spells(word: string, site: Site): boolean {
  const w = letters(word)
  if (!w) return false
  if (w === site.label) return true
  if (w.length >= 3 && site.all.includes(w)) return true
  return site.label.length >= 3 && w.includes(site.label)
}

/** The name in one part of a source, or null when the part does not spell the domain. */
function nameInPart(raw: string, site: Site): string | null {
  const part = raw
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(COUNTRY, '')
    .trim()
  const words = part.split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const marks = words.map((word) => spells(word, site))
  // Short words that spell the domain only together: Le Courier at lecourier.example.
  for (let start = 0; start < words.length; start++) {
    let joined = ''
    for (let end = start; end < words.length; end++) {
      joined += letters(words[end]!)
      if (!joined || !site.all.includes(joined)) break
      if (end > start && joined.length >= 3) for (let i = start; i <= end; i++) marks[i] = true
    }
  }
  const hits = marks.filter(Boolean).length
  const pageWords = words.some((word) => PAGE_WORD.test(trimmed(word)))
  // A word before the name that the domain does not spell is a parent brand's
  // or a mark (Northwind Harbor at harbor.example): the name is the word that
  // does. An article is part of the name, and a word after it is kept (Acme Parcel).
  if (words.length === 2 && !marks[0] && marks[1] && !pageWords && !ARTICLE.test(words[0]!))
    return trimmed(words[1]!)
  // A short part is the name as written: every word the domain's, or two words with one of them.
  if (
    hits > 0 &&
    !pageWords &&
    words.length <= MAX_NAME_WORDS &&
    (hits === words.length || words.length === 2)
  )
    return part
  // A sentence names the brand in the words that spell its domain.
  let best: string[] = []
  let run: string[] = []
  words.forEach((word, index) => {
    run = marks[index] ? [...run, word] : []
    if (run.length > best.length) best = run
  })
  if (best.length > 0) {
    const name = trimmed(best.join(' '))
    return name.charAt(0).toUpperCase() + name.slice(1)
  }
  // Initials: Northwind Post at np.example.
  const initialsOf = (list: string[]) => list.map((word) => letters(word).charAt(0)).join('')
  const initials = [initialsOf(words), initialsOf(words.filter((word) => !SMALL_WORD.test(word)))]
  if (!pageWords && words.length >= 2 && words.length <= 6 && initials.includes(site.label))
    return part
  return null
}

/** The name in one source: the first of its parts (as a title is divided) that spells the domain. */
function nameIn(source: string, site: Site): string | null {
  const clean = source.replace(/\s+/g, ' ').trim()
  if (!clean || clean.length > 400) return null
  // The address itself, written as one: not a name.
  if (clean === clean.toLowerCase() && clean.replace(/^www\./, '') === site.host) return null
  const parts = clean.split(/\s+[|\-–—·•»:]\s+|:\s+/)
  for (const part of parts) {
    const name = nameInPart(part.trim(), site)
    if (name && name.length <= MAX_NAME_CHARS) return name
  }
  return null
}

/** The site's own label, as letters: `acme` of docs.acme.co.uk. */
export function siteLabel(siteUrl: string): string | null {
  return siteOf(siteUrl)?.label ?? null
}

/**
 * The domain's label as a page's own words write it: `northwindexpress` is
 * Northwind Express, `payparcel` PayParcel. The spelling the page uses most,
 * a lower-case run (an address, a class name) never among them. Null when
 * the page does not write it.
 */
export function writtenAs(text: string, label: string): string | null {
  if (label.length < 3) return null
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${[...label].map((c) => c.replace(/[^\p{L}\p{N}]/gu, '')).join("[ \\-'’]?")}(?![\\p{L}\\p{N}])`,
    'giu'
  )
  const counts = new Map<string, number>()
  for (const match of text.slice(0, 200_000).matchAll(pattern)) {
    const written = match[0].replace(/\s+/g, ' ')
    if (written === written.toLowerCase()) continue
    counts.set(written, (counts.get(written) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/**
 * The site's name from `sources`, the most trusted first, or the domain's
 * own word when none of them spells it: as the page writes it (`written`),
 * else capitalised. Nothing when nothing was read.
 */
export function brandName(
  sources: readonly (string | null | undefined)[],
  siteUrl: string,
  { written }: { written?: string | null } = {}
): string | undefined {
  const site = siteOf(siteUrl)
  const read = sources
    .map((source) => source?.replace(/\s+/g, ' ').trim() ?? '')
    .filter((source) => source.length > 0)
  if (!site || read.length === 0) return undefined
  for (const source of read) {
    if (source.length > MAX_NAME_CHARS && !/\s/.test(source)) continue
    const name = nameIn(source, site)
    if (name) return name
  }
  if (written && letters(written) === site.label && written.length <= MAX_NAME_CHARS) return written
  return site.label.charAt(0).toUpperCase() + site.label.slice(1)
}
