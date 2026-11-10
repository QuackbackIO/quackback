/**
 * A bounded read of a brand's website: the homepage, up to four of its
 * stylesheets, its manifest, and the favicon, logo and share image worth
 * having. Nothing on the page runs. Every fetch goes through the injected
 * fetcher (live, recorded or replayed) under one byte budget and one time
 * budget, and every image is verified by its bytes (an SVG by the sanitiser).
 *
 * Never throws on a site's failure: what could not be read is null, with the
 * reason in `failed`. A fetcher reports failure as null; one that throws (the
 * strict snapshot fetcher, for a URL it has no record of) is a harness error
 * and its error propagates.
 */
import { logger } from '@/lib/server/logger'
import { fetchFollowingRedirects } from '@/lib/server/content/unfurl'
import { sniffImageMime } from '@/lib/server/content/magic-bytes'
import { imageDimensions } from '@/lib/server/content/image-dimensions'
import { sanitizeSvg, svgViewBoxSize } from '@/lib/server/content/svg-sanitize'
import { isStandardWebsiteUrl } from '@/lib/shared/website-branding'
import { isBotChallenge } from './challenge'
import { isConsentStylesheet } from './consent'
import { siteHost } from './host'
import { inlineStyles, manifestIcons, parseSiteFacts, stylesheetLinks } from './site-facts'
import type {
  FaviconCandidate,
  FetchedBody,
  LogoCandidate,
  SiteAsset,
  SiteFacts,
  SiteFetchKind,
  SiteFetcher,
  SiteRead,
} from './types'

const log = logger.child({ module: 'site-read' })

const DEFAULT_BUDGET_BYTES = 2_000_000
const DEFAULT_BUDGET_MS = 15_000
const PAGE_MAX_BYTES = 1_000_000
const CSS_MAX_BYTES = 600_000
const MAX_STYLESHEETS = 4
const MANIFEST_MAX_BYTES = 64 * 1024
const FAVICON_MAX_BYTES = 256 * 1024
const LOGO_MAX_BYTES = 1_000_000
const SHARE_MAX_BYTES = 5_000_000
const MAX_IMAGE_SIDE = 4096
const MAX_FAVICON_TRIES = 3
const MAX_LOGO_TRIES = 3

/** Second-level labels that sit under a two-letter country code as one public suffix (`co.uk`). */
const SECOND_LEVEL_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu', 'ltd', 'plc'])

/** The registrable domain, approximately: `shop.acme.co.uk` is `acme.co.uk`. */
export function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.')
  if (labels.length <= 2) return labels.join('.')
  const tld = labels[labels.length - 1]
  const second = labels[labels.length - 2]
  const take = tld.length === 2 && SECOND_LEVEL_SUFFIXES.has(second) ? 3 : 2
  return labels.slice(-take).join('.')
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * The stylesheets to read: the site's own first, then others, each group in
 * document order. A consent banner's stylesheet is never one of them.
 */
export function pickStylesheets(links: string[], pageUrl: string, max = MAX_STYLESHEETS): string[] {
  const site = registrableDomain(hostname(pageUrl))
  const brand = links.filter((link) => !isConsentStylesheet(link))
  const own = brand.filter((link) => registrableDomain(hostname(link)) === site)
  const others = brand.filter((link) => registrableDomain(hostname(link)) !== site)
  return [...own, ...others].slice(0, max)
}

const isHtml = (contentType: string, body: Uint8Array) => {
  const type = contentType.toLowerCase()
  if (type.includes('text/html') || type.includes('application/xhtml+xml')) return true
  if (type.trim()) return false
  const start = new TextDecoder().decode(body.subarray(0, 512)).trimStart().toLowerCase()
  return start.startsWith('<!doctype html') || start.startsWith('<html')
}

const decode = (body: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(body)
const ok = (status: number) => status >= 200 && status < 300

function isSvgResponse(res: FetchedBody): boolean {
  if (res.contentType.toLowerCase().includes('image/svg+xml')) return true
  try {
    return new URL(res.url).pathname.toLowerCase().endsWith('.svg')
  } catch {
    return false
  }
}

function svgAsset(markup: string, url: string, from: SiteAsset['from']): SiteAsset | null {
  const size = svgViewBoxSize(markup)
  if (!size || size.width > MAX_IMAGE_SIDE * 4 || size.height > MAX_IMAGE_SIDE * 4) return null
  return {
    url,
    mime: 'image/svg+xml',
    bytes: new TextEncoder().encode(markup),
    width: Math.round(size.width),
    height: Math.round(size.height),
    from,
  }
}

/** The fetched bytes as a verified image, or null. */
function verifyImage(
  res: FetchedBody,
  from: SiteAsset['from'],
  opts: { allowSvg: boolean; logoInk?: string }
): SiteAsset | null {
  if (!ok(res.status)) return null
  const buf = Buffer.from(res.body.buffer, res.body.byteOffset, res.body.byteLength)
  const mime = sniffImageMime(buf)
  if (mime) {
    const size = imageDimensions(buf, mime)
    if (!size || size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) return null
    return {
      url: res.url,
      mime: mime as SiteAsset['mime'],
      bytes: res.body,
      width: size.width,
      height: size.height,
      from,
    }
  }
  if (!opts.allowSvg || !isSvgResponse(res)) return null
  const clean = sanitizeSvg(decode(res.body), { currentColor: opts.logoInk })
  return clean ? svgAsset(clean, res.url, from) : null
}

const isPng = (icon: FaviconCandidate) =>
  icon.type === 'image/png' || /\.png(?:$|\?)/i.test(icon.url)
const isSvgIcon = (icon: FaviconCandidate) =>
  icon.type === 'image/svg+xml' || /\.svg(?:$|\?)/i.test(icon.url)

/** The favicon candidates in the order worth trying. */
export function rankFavicons(icons: FaviconCandidate[], pageUrl: string): string[] {
  const distance = (size: number) => (size < 64 ? 64 - size : size > 192 ? size - 192 : 0)
  const pngs = icons
    .filter((icon) => isPng(icon) && icon.size !== null && icon.size >= 32)
    .sort((a, b) => distance(a.size!) - distance(b.size!))
  const svgs = icons.filter(isSvgIcon)
  const touch = icons.filter((icon) => icon.from === 'apple-touch-icon')
  const rest = icons
  const ordered = [...pngs, ...svgs, ...touch, ...rest].map((icon) => icon.url)
  try {
    ordered.push(new URL('/favicon.ico', pageUrl).href)
  } catch {
    // No page URL to resolve against.
  }
  return [...new Set(ordered)]
}

interface Budget {
  get(url: string, kind: SiteFetchKind, maxBytes: number): Promise<FetchedBody | null>
  bytesUsed(): number
  elapsed(): number
}

function budgeted(
  fetcher: SiteFetcher,
  budgetBytes: number,
  budgetMs: number,
  now: () => number
): Budget {
  const start = now()
  let bytesLeft = budgetBytes
  const cache = new Map<string, Promise<FetchedBody | null>>()
  const fetchOnce = async (url: string, kind: SiteFetchKind, maxBytes: number) => {
    const timeoutMs = budgetMs - (now() - start)
    if (timeoutMs <= 0 || bytesLeft <= 0) return null
    // Reserve the most this fetch may take, so parallel fetches share the budget, then refund.
    const reserved = Math.min(maxBytes, bytesLeft)
    bytesLeft -= reserved
    let res: FetchedBody | null = null
    try {
      res = await fetcher(url, kind, { maxBytes: reserved, timeoutMs })
    } finally {
      const used = res ? Math.min(res.body.byteLength, reserved) : 0
      bytesLeft += reserved - used
    }
    if (!res) return null
    return res.body.byteLength > reserved ? { ...res, body: res.body.subarray(0, reserved) } : res
  }
  return {
    get(url, kind, maxBytes) {
      const key = `${kind} ${url}`
      let pending = cache.get(key)
      if (!pending) {
        pending = fetchOnce(url, kind, maxBytes)
        cache.set(key, pending)
      }
      return pending
    },
    bytesUsed: () => budgetBytes - bytesLeft,
    elapsed: () => now() - start,
  }
}

async function firstVerified<T>(
  items: T[],
  attempt: (item: T) => Promise<SiteAsset | null>
): Promise<SiteAsset | null> {
  for (const item of items) {
    const asset = await attempt(item)
    if (asset) return asset
  }
  return null
}

async function readLogo(
  logos: LogoCandidate[],
  budget: Budget,
  pageUrl: string,
  logoInk: string | undefined
): Promise<SiteAsset | null> {
  return firstVerified(logos.slice(0, MAX_LOGO_TRIES), async (logo) => {
    if (logo.from === 'header-svg') {
      const clean = logo.svg ? sanitizeSvg(logo.svg, { currentColor: logoInk }) : null
      return clean ? svgAsset(clean, pageUrl, 'header-svg') : null
    }
    if (!logo.url) return null
    const res = await budget.get(logo.url, 'image', LOGO_MAX_BYTES)
    return res ? verifyImage(res, logo.from, { allowSvg: true, logoInk }) : null
  })
}

/** Reads a site's homepage, stylesheets and brand images within the budgets. */
export async function readSite(
  url: string,
  fetcher: SiteFetcher,
  opts: { budgetBytes?: number; budgetMs?: number; now?: () => number; logoInk?: string } = {}
): Promise<SiteRead> {
  const empty: SiteRead = { facts: null, favicon: null, logo: null, shareImage: null, failed: null }
  const site = siteHost(url)
  if (!site) {
    log.warn({ failed: 'blocked_url' }, 'site read refused the URL')
    return { ...empty, failed: 'blocked_url' }
  }
  const host = site.host
  const budget = budgeted(
    fetcher,
    opts.budgetBytes ?? DEFAULT_BUDGET_BYTES,
    opts.budgetMs ?? DEFAULT_BUDGET_MS,
    opts.now ?? Date.now
  )
  const fail = (
    failed: NonNullable<SiteRead['failed']>,
    facts: SiteFacts | null = null
  ): SiteRead => {
    log.warn({ host, failed, bytes: budget.bytesUsed(), ms: budget.elapsed() }, 'site read failed')
    return { ...empty, facts, failed }
  }

  const page = await budget.get(site.url, 'page', PAGE_MAX_BYTES)
  if (!page) return fail('fetch_failed')
  if (!isHtml(page.contentType, page.body)) return fail('not_html')
  const html = decode(page.body)
  if (isBotChallenge(html, page.status))
    return fail('challenge', parseSiteFacts(html, page.url, []))
  if (!ok(page.status)) return fail('fetch_failed')

  const picked = pickStylesheets(stylesheetLinks(html, page.url), page.url)
  const fetched = await Promise.all(
    picked.map(async (link) => {
      const res = await budget.get(link, 'css', CSS_MAX_BYTES)
      if (!res || !ok(res.status) || res.contentType.toLowerCase().includes('text/html'))
        return null
      return { url: link, css: decode(res.body) }
    })
  )
  // Sheets are parsed in document order, the inline styles after them, as the cascade runs.
  const sheets = stylesheetLinks(html, page.url)
    .map((link) => fetched.find((sheet) => sheet?.url === link))
    .filter((sheet): sheet is { url: string; css: string } => Boolean(sheet))
  const inline = inlineStyles(html)
  const facts = parseSiteFacts(
    html,
    page.url,
    inline ? [...sheets, { url: `${page.url}#inline`, css: inline }] : sheets
  )
  facts.stylesheets = sheets.map((sheet) => sheet.url)

  if (facts.manifest) {
    const res = await budget.get(facts.manifest, 'manifest', MANIFEST_MAX_BYTES)
    if (res && ok(res.status)) facts.favicons.push(...manifestIcons(decode(res.body), res.url))
  }

  const [favicon, logo, shareImage] = await Promise.all([
    firstVerified(
      rankFavicons(facts.favicons, page.url).slice(0, MAX_FAVICON_TRIES + 1),
      async (iconUrl) => {
        const res = await budget.get(iconUrl, 'image', FAVICON_MAX_BYTES)
        const from = facts.favicons.find((icon) => icon.url === iconUrl)?.from ?? 'icon'
        return res ? verifyImage(res, from, { allowSvg: true }) : null
      }
    ),
    readLogo(facts.logos, budget, page.url, opts.logoInk),
    facts.shareImage
      ? budget
          .get(facts.shareImage, 'image', SHARE_MAX_BYTES)
          .then((res) => (res ? verifyImage(res, 'share', { allowSvg: false }) : null))
      : Promise.resolve(null),
  ])

  log.info(
    {
      host,
      stylesheets: sheets.length,
      favicons: facts.favicons.length,
      logos: facts.logos.length,
      favicon: Boolean(favicon),
      logo: logo?.from ?? null,
      share_image: Boolean(shareImage),
      bytes: budget.bytesUsed(),
      ms: budget.elapsed(),
    },
    'site read'
  )
  return { facts, favicon, logo, shareImage, failed: null }
}

/** A desktop browser's user agent: some sites serve a stripped page to anything else. */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const ACCEPT: Record<SiteFetchKind, string> = {
  page: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  css: 'text/css,*/*;q=0.1',
  image: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
  manifest: 'application/manifest+json,application/json;q=0.9,*/*;q=0.5',
}

/**
 * Fetches from the live web. Every hop of a redirect goes through the SSRF
 * guard and must be a standard website URL; no cookies or credentials are
 * sent; the body is cut at maxBytes. Null on any failure.
 */
export const liveSiteFetcher: SiteFetcher = async (url, kind, limits) => {
  try {
    const result = await fetchFollowingRedirects(url, {
      allowUrl: isStandardWebsiteUrl,
      headers: {
        accept: ACCEPT[kind],
        'accept-language': 'en;q=0.9,*;q=0.5',
        'user-agent': BROWSER_USER_AGENT,
      },
      timeoutMs: limits.timeoutMs,
      maxBytes: limits.maxBytes,
    })
    if (!result) return null
    const body = new Uint8Array(await result.response.arrayBuffer())
    return {
      status: result.response.status,
      url: result.finalUrl,
      contentType: result.response.headers.get('content-type') ?? '',
      body: body.byteLength > limits.maxBytes ? body.subarray(0, limits.maxBytes) : body,
    }
  } catch {
    return null
  }
}
