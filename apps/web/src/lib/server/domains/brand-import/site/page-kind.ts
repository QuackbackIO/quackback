/**
 * Whether the page a reader was served is the site's own homepage, or
 * something shown in its place: an error or maintenance page or a queue, a
 * bot check, or a country picker. Import reads only the site's own page and
 * tells the person which of the others it met; it never tries to get past one.
 *
 * Pure, from a few signs either reader can give: the document's HTTP status,
 * its title and first heading, how many words it shows and how they start,
 * its links, and whether anything of the brand (a logo, a button) was on it.
 * A real page is never refused for a word it uses: the words that mark an
 * error or a picker count in the title and heading, and in the text only on
 * a page with little else on it.
 */

export type PageKind = 'page' | 'error' | 'bot' | 'picker'

export interface PageLink {
  /** Absolute. */
  href: string
  /** Its words, cut short. */
  text: string
}

export interface PageSigns {
  /** The main document's HTTP status, when the reader knows it. */
  status?: number | null
  title: string
  /** The first heading's words. */
  heading: string
  /** How the page's visible text starts. */
  lead: string
  /** The length of the page's visible text, in characters. */
  words: number
  links: PageLink[]
  /** Something of the brand was read on it: a logo, a button, a colour of its own. */
  brandLike: boolean
}

/** Text under this length is a page with little else on it. */
const SHORT_PAGE = 2_000
/** An error's own words in the text count on a page this short. */
const NOTICE_PAGE = 800
/**
 * A page this short with nothing of the brand on it (no logo, no button) is a
 * splash or a blank. Kept low: a plain site of a few lines and no logo is a
 * real site, and must still import.
 */
const BLANK_PAGE = 150
/** A picker names itself in its title or heading on a page under this length. */
const PICKER_PAGE = 4_000

const BOT_PHRASES =
  /(?:verify|confirm|prove)(?: that)? you(?:['’]re| are)(?: a)? human|are you a (?:robot|human)|unusual traffic|just a moment|access denied|you have been blocked|request unsuccessful|attention required|pardon our interruption|unable to give you access|security check\b(?!list)|security verification|press (?:and|&) hold|verifying you are human|human or a bot|bot or not|(?:has|have) been (?:temporarily )?blocked|ip address is blocked/i
/** A bot check's own script, shown as the page's only words. */
const BOT_SCRIPT = /\bvar dd=\{['"]rt['"]/
/**
 * The line a form's captcha service asks every site that uses it to show
 * ("This site is protected by reCAPTCHA and the Google Privacy Policy..."): a
 * real page's footer, not a bot check's words.
 */
const CAPTCHA_NOTICE = /protected by \w*captcha\b/gi
/** On a page with little else on it, the word alone says it. */
const BOT_WORDS = new RegExp(`captcha|${BOT_PHRASES.source}`, 'i')

/** A part of a title that is an error's, whole: `Error`, `Error Page`, `404`, `Information Page`. */
const ERROR_TITLE_PART =
  /^(?:error(?: page| \d{3})?|\d{3}(?: .{0,40})?|(?:page )?not found|forbidden|service unavailable|temporarily unavailable|information page|(?:site |under |scheduled )?maintenance|be right back|coming soon)$/i
/** What an error, maintenance or queue page's heading says. */
const ERROR_HEADING =
  /something went wrong|an error (?:has )?occurred|we(?:['’]re| are) working on it|be right back|we(?:['’]ll| will) be (?:right )?back|temporarily unavailable|(?:page|site) (?:not found|is unavailable)|down for maintenance|under maintenance|high demand|waiting room|you are in (?:the|a) queue/i
/** The same, said in the text of a page with little else on it. */
const ERROR_NOTICE =
  /something went wrong|an error has occurred|experiencing high demand|you are (?:now )?in (?:the|a) (?:queue|line)|waiting room|maintenance is in progress|down for maintenance|scheduled maintenance|temporarily unavailable/i

const PICKER_WORDS =
  /(?:select|choose|pick)\s+(?:your\s+|a\s+|the\s+)?(?:country|region|location|market)\b|\bselect your (?:country|region)/i

/**
 * Countries by the names a picker lists them under, with their codes as
 * addresses write them (`/uk`, `/en-gb`, `.co.uk`).
 */
const COUNTRIES: ReadonlyArray<readonly [codes: string[], names: string[]]> = [
  [
    ['us', 'usa'],
    ['united states', 'usa', 'u.s.', 'united states of america'],
  ],
  [
    ['gb', 'uk'],
    ['united kingdom', 'uk', 'great britain'],
  ],
  [['ca'], ['canada']],
  [['au'], ['australia']],
  [['nz'], ['new zealand']],
  [['ie'], ['ireland']],
  [['de'], ['germany', 'deutschland']],
  [['fr'], ['france']],
  [['es'], ['spain', 'españa']],
  [['it'], ['italy', 'italia']],
  [['nl'], ['netherlands', 'nederland']],
  [['be'], ['belgium', 'belgië', 'belgique']],
  [['pt'], ['portugal']],
  [['ch'], ['switzerland', 'schweiz', 'suisse']],
  [['at'], ['austria', 'österreich']],
  [['se'], ['sweden', 'sverige']],
  [['no'], ['norway', 'norge']],
  [['dk'], ['denmark', 'danmark']],
  [['fi'], ['finland', 'suomi']],
  [['pl'], ['poland', 'polska']],
  [['cz'], ['czech republic', 'czechia']],
  [['gr'], ['greece']],
  [['tr'], ['turkey', 'türkiye']],
  [['ro'], ['romania']],
  [['hu'], ['hungary']],
  [['mx'], ['mexico', 'méxico']],
  [['br'], ['brazil', 'brasil']],
  [['ar'], ['argentina']],
  [['cl'], ['chile']],
  [['co'], ['colombia']],
  [['pe'], ['peru', 'perú']],
  [['jp'], ['japan', '日本']],
  [['cn'], ['china', '中国']],
  [['kr'], ['south korea', 'korea']],
  [['in'], ['india']],
  [['sg'], ['singapore']],
  [['my'], ['malaysia']],
  [['th'], ['thailand']],
  [['id'], ['indonesia']],
  [['ph'], ['philippines']],
  [['vn'], ['vietnam']],
  [['hk'], ['hong kong']],
  [['tw'], ['taiwan']],
  [['ae'], ['united arab emirates', 'uae']],
  [['sa'], ['saudi arabia']],
  [['il'], ['israel']],
  [['eg'], ['egypt']],
  [['za'], ['south africa']],
  [['ng'], ['nigeria']],
  [['bo'], ['bolivia']],
  [['cr'], ['costa rica']],
  [['do'], ['dominican republic', 'dominicana', 'república dominicana']],
  [['ec'], ['ecuador']],
  [['gt'], ['guatemala']],
  [['hn'], ['honduras']],
  [['ni'], ['nicaragua']],
  [['pa'], ['panama', 'panamá']],
  [['py'], ['paraguay']],
  [['sv'], ['el salvador']],
  [['uy'], ['uruguay']],
  [['ve'], ['venezuela']],
  [['pr'], ['puerto rico']],
  [['lu'], ['luxembourg']],
  [['is'], ['iceland']],
  [['hr'], ['croatia']],
  [['bg'], ['bulgaria']],
  [['sk'], ['slovakia']],
  [['si'], ['slovenia']],
  [['rs'], ['serbia']],
  [['ee'], ['estonia']],
  [['lv'], ['latvia']],
  [['lt'], ['lithuania']],
  [['ua'], ['ukraine']],
  [['pk'], ['pakistan']],
  [['bd'], ['bangladesh']],
  [['ma'], ['morocco']],
  [['qa'], ['qatar']],
  [['kw'], ['kuwait']],
  [['cy'], ['cyprus']],
  [['mt'], ['malta']],
  [['ke'], ['kenya']],
]
const COUNTRY_BY_NAME = new Map(
  COUNTRIES.flatMap(([codes, names]) => names.map((name) => [name, codes[0]!] as const))
)

const plain = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase()
/** The country a link's words name, by its code, or null. */
const countryOf = (text: string) => COUNTRY_BY_NAME.get(plain(text)) ?? null

/** A picker by its links alone: mostly a list of countries. */
const PICKER_MIN_COUNTRIES = 8
const PICKER_COUNTRY_SHARE = 0.3
/** And little else on it: a full homepage that lists its countries is the homepage. */
const PICKER_LIST_PAGE = 1_500

export function pageKind(signs: PageSigns): PageKind {
  const head = `${signs.title} ${signs.heading}`
  const short = signs.words < SHORT_PAGE
  const refused = signs.status === 403 || signs.status === 429 || signs.status === 503
  if (BOT_PHRASES.test(signs.title)) return 'bot'
  if ((short || refused) && BOT_WORDS.test(`${head} ${signs.lead}`.replace(CAPTCHA_NOTICE, ' ')))
    return 'bot'
  if (short && BOT_SCRIPT.test(signs.lead)) return 'bot'
  if (signs.status != null && signs.status >= 400) return 'error'

  if (signs.words < PICKER_PAGE && PICKER_WORDS.test(head)) return 'picker'
  const named = signs.links.filter((link) => link.text.length > 0)
  const countries = new Set(named.map((link) => countryOf(link.text)).filter(Boolean))
  if (
    signs.words < PICKER_LIST_PAGE &&
    countries.size >= PICKER_MIN_COUNTRIES &&
    named.filter((link) => countryOf(link.text)).length >= PICKER_COUNTRY_SHARE * named.length
  )
    return 'picker'

  const titleParts = signs.title.split(/\s+[|\-–—·:]\s+/).map((part) => part.trim())
  if (short && titleParts.some((part) => ERROR_TITLE_PART.test(part))) return 'error'
  if (short && ERROR_HEADING.test(signs.heading)) return 'error'
  if (signs.words < NOTICE_PAGE && ERROR_NOTICE.test(signs.lead)) return 'error'
  if (signs.words < BLANK_PAGE && !signs.brandLike) return 'error'
  return 'page'
}

/** A host's name without `www.` and its ending: `northwind` of www.northwind.co.uk. */
function siteWord(host: string): string {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')
  const own = labels.length > 1 ? labels.slice(0, -1) : labels
  const named = own.filter((label, index) => index === 0 || !/^(?:co|com|org|net)$/.test(label))
  return named.at(-1) ?? ''
}

const COUNTRY_CODES = new Map(
  COUNTRIES.flatMap(([codes]) => codes.map((code) => [code, codes[0]!] as const))
)
/** A path segment that is a language's or a country's: `us`, `en-gb`, `fr_CA`. */
const LOCALE_SEGMENT = /^[a-z]{2}(?:[-_](?:[a-z]{2}|han[st]))?$/i
const HOME_SEGMENT = /^(?:home|index)(?:\.[a-z]+)?$/i
/** A choice of country or language carried in the address. */
const LOCALE_QUERY = /[?&](?:country|region|locale|lang|language|market|cc)=[\w-]{2,}/i
const bare = (host: string) => host.toLowerCase().replace(/^www\./, '')
const segmentsOf = (to: URL) => to.pathname.split('/').filter(Boolean)
const countryInSegment = (segment: string) =>
  countryOf(decodeURIComponent(segment).replace(/[-_]/g, ' '))

/**
 * Whether an address on the picker's own host is a country's or a language's
 * home: a few segments, each a code, a locale or a country's name (`/us`,
 * `/en-gb`, `/ca/fr`, `/germany`), or the root with the choice in its query.
 * Any other page of the site (an opt-out, a store finder) is not, and nor is
 * the picker itself.
 */
function localHome(to: URL): boolean {
  const segments = segmentsOf(to)
  if (segments.every((segment) => HOME_SEGMENT.test(segment))) return LOCALE_QUERY.test(to.search)
  return (
    segments.length <= 3 &&
    segments.every(
      (segment) =>
        LOCALE_SEGMENT.test(segment) ||
        HOME_SEGMENT.test(segment) ||
        countryInSegment(segment) !== null
    )
  )
}

/** The country an address names: in its ending, its first label, or its path. */
function countryInAddress(to: URL, pageHost: string): string | null {
  const labels = bare(to.hostname).split('.')
  if (bare(to.hostname) !== pageHost) {
    const named = COUNTRY_CODES.get(labels.at(-1)!) ?? COUNTRY_CODES.get(labels[0]!)
    if (named) return named
  }
  for (const segment of segmentsOf(to).slice(0, 3)) {
    const locale = /^[a-z]{2,3}[-_]([a-z]{2})$/i.exec(segment)
    const named =
      COUNTRY_CODES.get((locale?.[1] ?? segment).toLowerCase()) ?? countryInSegment(segment)
    if (named) return named
  }
  return (
    COUNTRY_CODES.get(
      /[?&](?:country|region|cc)=([a-z]{2})\b/i.exec(to.search)?.[1]?.toLowerCase() ?? ''
    ) ?? null
  )
}

/** A language with its country: `en-gb`, `fr_CA`. */
const REGION_LOCALE = /^[a-z]{2,3}[-_][a-z]{2}$/i
/** A link named for a language, not a country, is this short. */
const LANGUAGE_LINK_CHARS = 40

/**
 * Up to three of a picker page's country links, as addresses the person can
 * import instead: the country of the admin's own languages first, then the
 * United States, then the page's order. A link counts when its words name a
 * country, or its address is a country's home and names it. Only links to
 * the site itself, or to its own name under another ending
 * (`northwind.co.uk`); on the picker's own host, only a country's or a
 * language's home, never another page of the site. For one country, the
 * address that names it comes first.
 */
export function pickerCandidates(
  links: readonly PageLink[],
  pageUrl: string,
  languages: readonly string[]
): string[] {
  let site: string
  let pageHost: string
  try {
    const page = new URL(pageUrl)
    site = siteWord(page.hostname)
    pageHost = bare(page.hostname)
  } catch {
    return []
  }
  const wanted = languages
    .map((tag) => tag.toLowerCase().split('-')[1] ?? '')
    .filter(Boolean)
    .map((region) => COUNTRY_CODES.get(region) ?? region)
  const seen = new Set<string>()
  const offered = links.flatMap((link, index) => {
    try {
      const to = new URL(link.href)
      if (!/^https?:$/.test(to.protocol) || siteWord(to.hostname) !== site) return []
      const sameHost = bare(to.hostname) === pageHost
      if (sameHost && !localHome(to)) return []
      const inAddress = countryInAddress(to, pageHost)
      // Named for a language (`English`), it counts when its whole address is one locale's home.
      const locale = segmentsOf(to).length === 1 && REGION_LOCALE.test(segmentsOf(to)[0]!)
      const country =
        countryOf(link.text) ??
        (sameHost && locale && link.text.length <= LANGUAGE_LINK_CHARS ? inAddress : null)
      if (!country) return []
      to.hash = ''
      if (seen.has(to.href)) return []
      seen.add(to.href)
      return [{ href: to.href, country, named: inAddress === country, index }]
    } catch {
      return []
    }
  })
  const rank = (country: string) => {
    const mine = wanted.indexOf(country)
    return mine !== -1 ? mine : country === 'us' ? wanted.length : wanted.length + 1
  }
  return offered
    .sort(
      (a, b) =>
        rank(a.country) - rank(b.country) ||
        (a.country === b.country ? Number(b.named) - Number(a.named) : 0) ||
        a.index - b.index
    )
    .slice(0, 3)
    .map((link) => link.href)
}

const MAX_SCAN = 600_000
const LEAD_CHARS = 1_500
const MAX_LINKS = 150

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&#39;': '’',
  '&#x27;': '’',
  '&apos;': '’',
  '&rsquo;': '’',
  '&quot;': '"',
}
/** Each entity decoded once, so `&amp;quot;` stays `&quot;`. */
const decoded = (text: string) =>
  text.replace(
    /&(?:nbsp|amp|#39|#x27|apos|rsquo|quot);/gi,
    (entity) => ENTITIES[entity.toLowerCase()] ?? entity
  )
const textOf = (markup: string) =>
  decoded(markup.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** The signs of a page from its HTML, nothing run: for the static reader. */
export function signsFromHtml(
  html: string,
  status: number | null,
  pageUrl: string
): Omit<PageSigns, 'brandLike'> {
  const page = html.slice(0, MAX_SCAN)
  const body = page
    .replace(/<head\b[\s\S]*?<\/head\s*>/i, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  const text = textOf(body)
  const links: PageLink[] = []
  for (const match of body.matchAll(
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi
  )) {
    if (links.length >= MAX_LINKS) break
    const href = decoded(match[1] ?? match[2] ?? '').trim()
    const words = textOf(match[3] ?? '').slice(0, 60)
    if (!href || href.startsWith('#') || !words) continue
    try {
      links.push({ href: new URL(href, pageUrl).href, text: words })
    } catch {
      // Not an address.
    }
  }
  return {
    status,
    title: textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1] ?? '').slice(0, 300),
    heading: textOf(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(body)?.[1] ?? '').slice(0, 200),
    lead: text.slice(0, LEAD_CHARS),
    words: text.length,
    links,
  }
}
