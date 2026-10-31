/**
 * What a website says about its brand, for Quackback AI's directions: its
 * name and description, its colours, its page background and its fonts.
 * Fetched with the same SSRF-guarded fetch the logo lookup uses, and nothing
 * is stored.
 *
 * The reader says who it is and asks as a browser would for a page, a
 * manifest and the stylesheets the page links. It tries the address as given
 * and with or without `www.`. A site that answers with a bot check or a
 * refusal is reported as blocked rather than read, and it never tries to get
 * past one: a screenshot reads any site.
 */
import { fetchFollowingRedirects } from '@/lib/server/content/unfurl'
import { logger } from '@/lib/server/logger'
import { isStandardWebsiteUrl, parseWebsiteInput } from '@/lib/shared/website-branding'
import { isBlockPage, pageLinks, readSiteBrand, type SiteBrand } from './site-brand'
import { colourVividness } from '@/lib/shared/design/palette'
import { findHeaderLogo, findShareImage, resolveSvgColours, type LogoCandidate } from './site-logo'

/**
 * The colour a logo drawn in the page's current colour most likely takes: a
 * monochrome brand's near-black, else the most vivid colour the site uses,
 * which a logo usually is.
 */
function logoColour(brand: SiteBrand): string {
  if (brand.monochrome) return '#111111'
  const vivid = [...brand.palette].sort((a, b) => colourVividness(b) - colourVividness(a))[0]
  return vivid ?? brand.colour ?? '#111111'
}

const log = logger.child({ module: 'site-signals' })

export interface SiteSignals extends SiteBrand {
  domain: string
  /** Its header logo: inline, with the colours it takes from the page written in, or an address. */
  logo: LogoCandidate | null
  /** The image it gives link previews. */
  shareImage: string | null
}

export type SiteRead =
  | { ok: true; signals: SiteSignals }
  /** blocked: the site refused an automated visit. unreachable: no page came back. */
  | { ok: false; reason: 'blocked' | 'unreachable' }

const AGENT = 'Mozilla/5.0 (compatible; QuackbackBrandReader/1.0; +https://quackback.io)'
const PAGE_BYTES = 3 * 1024 * 1024
const CSS_BYTES = 1024 * 1024
const MAX_STYLESHEETS = 4
const MANIFEST_PATHS = ['/manifest.json', '/site.webmanifest', '/manifest.webmanifest']

async function get(url: string, accept: string, maxBytes: number, timeoutMs: number) {
  const fetched = await fetchFollowingRedirects(url, {
    allowUrl: isStandardWebsiteUrl,
    headers: { accept, 'accept-language': 'en', 'user-agent': AGENT },
    timeoutMs,
    maxBytes,
  }).catch(() => null)
  if (!fetched) return null
  return {
    status: fetched.response.status,
    type: fetched.response.headers.get('content-type')?.toLowerCase() ?? '',
    finalUrl: fetched.finalUrl,
    text: () => fetched.response.text(),
  }
}

const REFUSALS = new Set([202, 401, 403, 406, 429, 503])

type Page = { kind: 'page'; html: string; url: string } | { kind: 'blocked' } | null

async function page(url: string, followed = false): Promise<Page> {
  const response = await get(
    url,
    'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    PAGE_BYTES,
    9000
  )
  if (!response) return null
  if (REFUSALS.has(response.status)) return { kind: 'blocked' }
  if (response.status >= 400 || !response.type.includes('html')) return null
  const html = await response.text()
  if (isBlockPage(html)) return { kind: 'blocked' }
  // A page that only sends the visitor on, by a meta refresh, is followed once.
  const refresh =
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\d+\s*;\s*url=([^"'>]+)/i.exec(html)
  if (refresh && !followed) {
    try {
      return await page(new URL(refresh[1]!.trim(), response.finalUrl).href, true)
    } catch {
      return null
    }
  }
  return { kind: 'page', html, url: response.finalUrl }
}

async function manifest(urls: string[]) {
  for (const url of urls) {
    const response = await get(
      url,
      'application/manifest+json,application/json;q=0.9',
      64 * 1024,
      5000
    )
    if (!response || response.status >= 400) continue
    try {
      const parsed: unknown = JSON.parse(await response.text())
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      // A manifest that is not JSON says nothing.
    }
  }
  return null
}

async function stylesheets(urls: string[]): Promise<string[]> {
  const texts = await Promise.all(
    urls.slice(0, MAX_STYLESHEETS).map(async (url) => {
      const response = await get(url, 'text/css,*/*;q=0.1', CSS_BYTES, 6000)
      return response && response.status < 400 ? await response.text().catch(() => '') : ''
    })
  )
  return texts.filter(Boolean)
}

export async function readSiteSignals(site: string): Promise<SiteRead> {
  const parsed = parseWebsiteInput(site)
  if (!parsed) return { ok: false, reason: 'unreachable' }
  const host = parsed.hostname.toLowerCase()
  const hosts = host.startsWith('www.') ? [host, host.slice(4)] : [host, `www.${host}`]
  let blocked = false
  for (const candidate of hosts) {
    const found = await page(`https://${candidate}/`)
    if (found?.kind === 'blocked') blocked = true
    if (found?.kind !== 'page') continue
    const links = pageLinks(found.html, found.url)
    const origin = new URL(found.url).origin
    const [siteManifest, css] = await Promise.all([
      manifest(links.manifest ? [links.manifest] : MANIFEST_PATHS.map((path) => origin + path)),
      stylesheets(links.stylesheets),
    ])
    const sheets = [links.inlineCss, ...css]
    const brand = readSiteBrand({ html: found.html, css: sheets, manifest: siteManifest })
    const header = findHeaderLogo(found.html, found.url)
    const logo =
      header && 'svg' in header
        ? { svg: resolveSvgColours(header.svg, sheets, logoColour(brand), header.classes) }
        : header
    const shareImage = findShareImage(found.html, found.url)
    log.info(
      {
        host,
        colour: brand.colour,
        stylesheets: css.length,
        logo: !!logo,
        shareImage: !!shareImage,
      },
      'website read for its brand'
    )
    return { ok: true, signals: { domain: host, ...brand, logo, shareImage } }
  }
  if (blocked) {
    // The page refused, but a manifest is a static file sites often serve to anyone.
    const siteManifest = await manifest(MANIFEST_PATHS.map((path) => `https://${host}${path}`))
    const brand = siteManifest ? readSiteBrand({ html: '', css: [], manifest: siteManifest }) : null
    if (brand && (brand.colour || brand.title)) {
      log.info({ host }, 'website blocked its page; read its manifest')
      return { ok: true, signals: { domain: host, ...brand, logo: null, shareImage: null } }
    }
  }
  log.info({ host, blocked }, 'website could not be read for its brand')
  return { ok: false, reason: blocked ? 'blocked' : 'unreachable' }
}
