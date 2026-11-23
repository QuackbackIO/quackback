/**
 * The browser reader: asks the browser sidecar (docker/browser, configured by
 * QUACKBACK_BROWSER_URL and QUACKBACK_BROWSER_TOKEN) to render a site's
 * homepage and measure it, then reads the measurements as a `BrandRead`.
 *
 * Import calls it only after robots.txt allowed the read, beside the static
 * reader, and prefers its values. It retries once when the sidecar is briefly
 * unavailable (502, 503) and otherwise gives up quietly, so a slow, busy or
 * missing sidecar leaves Import with the static read. Nothing the sidecar
 * sends is trusted: replies are size capped and validated, an SVG logo is
 * sanitised, and an image logo is fetched through the SSRF-guarded fetcher and
 * verified by its bytes, or left out.
 */
import { z } from 'zod'
import { measureSchema } from './browser/measure-schema'
import { logger } from '@/lib/server/logger'
import { sniffImageMime } from '@/lib/server/content/magic-bytes'
import { imageDimensions } from '@/lib/server/content/image-dimensions'
import { sanitizeSvg } from '@/lib/server/content/svg-sanitize'
import type { BrandRead } from '@/lib/shared/theme/brand-import'
import { brandReadFromMeasure, colourOver } from './browser/measure-read'
import type { PageLogo, PageMeasure } from './browser/page-measure'
import type { BrandReader, BrandReaderResult } from './readers'
import { pageKind } from './site/page-kind'
import { classifySiteFont } from './site/site-font'
import { ICON_MAX_BYTES, liveSiteFetcher, readAppIcon } from './site/site-read'
import type { SiteFetcher } from './site/types'

const log = logger.child({ component: 'browser-reader' })

/** The whole wait for a read, retry included: Import waits on it. */
const TIMEOUT_MS = 25_000
/** The measure, a megabyte of logo and icons and four font files (text and headings), base64. */
const REPLY_MAX_BYTES = 5 * 1024 * 1024
const LOGO_MAX_BYTES = 1_000_000
const LOGO_TIMEOUT_MS = 5_000
const MAX_IMAGE_SIDE = 4096
/** The sidecar refuses to start with a shorter token. */
const MIN_TOKEN_LENGTH = 16
const RETRY_STATUSES = new Set([502, 503])
/** Image types storage accepts as a logo. */
const LOGO_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])

const replySchema = z.object({ ok: z.literal(true), measure: measureSchema })

export interface BrowserReaderOptions {
  /** The sidecar's base URL, such as http://browser:3200. */
  url: string
  token: string
  /** How an image logo is fetched; the live, SSRF-guarded web by default. */
  fetcher?: SiteFetcher
  timeoutMs?: number
}

/** The reply's body as text, or null past the cap. */
async function cappedText(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'))
  if (declared > REPLY_MAX_BYTES) return null
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > REPLY_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** The image logo's bytes: fetched through the guarded fetcher, or a data URL decoded. */
async function logoBytes(
  src: string,
  fetcher: SiteFetcher
): Promise<{ body: Uint8Array; svg: boolean } | null> {
  const data = /^data:(image\/[\w.+-]+)?(;base64)?,(.*)$/is.exec(src)
  if (data) {
    if (src.length > LOGO_MAX_BYTES * 1.4) return null
    const body = data[2]
      ? Uint8Array.from(Buffer.from(data[3]!, 'base64'))
      : new TextEncoder().encode(decodeURIComponent(data[3]!))
    return { body, svg: data[1]?.toLowerCase() === 'image/svg+xml' }
  }
  const res = await fetcher(src, 'image', { maxBytes: LOGO_MAX_BYTES, timeoutMs: LOGO_TIMEOUT_MS })
  if (!res || res.status < 200 || res.status >= 300) return null
  const svg =
    res.contentType.toLowerCase().includes('image/svg+xml') ||
    /\.svg(?:$|[?#])/i.test(new URL(res.url || src).pathname)
  return { body: res.body, svg }
}

/** The logo the page shows, verified, or undefined when it cannot be trusted. */
async function verifiedLogo(
  logo: PageLogo,
  read: BrandRead,
  fetcher: SiteFetcher
): Promise<BrandRead['logo']> {
  const inks = (logo.inks ?? []).flatMap(({ color, share, box, plate }) => {
    const hex = colourOver(color)
    return hex ? [{ color: hex, share, ...(box ? { box } : {}), ...(plate ? { plate } : {}) }] : []
  })
  const size = { widthPx: logo.w, heightPx: logo.h, ...(inks.length > 0 ? { inks } : {}) }
  if (logo.svg !== undefined) {
    const ink = logo.color ? colourOver(logo.color) : read.page?.text
    const svg = sanitizeSvg(logo.svg, { currentColor: ink })
    return svg ? { svg, ...size, from: 'header-svg' } : undefined
  }
  if (!logo.src) return undefined
  const fetched = await logoBytes(logo.src, fetcher).catch(() => null)
  if (!fetched) return undefined
  const buf = Buffer.from(fetched.body.buffer, fetched.body.byteOffset, fetched.body.byteLength)
  const mime = sniffImageMime(buf)
  if (mime) {
    const dims = imageDimensions(buf, mime)
    if (!LOGO_MIMES.has(mime) || !dims) return undefined
    if (dims.width > MAX_IMAGE_SIDE || dims.height > MAX_IMAGE_SIDE) return undefined
    return { raster: { bytes: fetched.body, mime }, ...size, from: 'header-img' }
  }
  if (!fetched.svg) return undefined
  const svg = sanitizeSvg(new TextDecoder().decode(fetched.body), {
    currentColor: read.page?.text,
  })
  return svg ? { svg, ...size, from: 'header-img' } : undefined
}

/**
 * A fetcher that answers from the images the browser loaded while rendering
 * the page, and fetches only what it did not load. A site's bot check can
 * refuse a fetch of our own a moment after it served the browser the same
 * file. The bytes are as untrusted as a fetch's and verified the same way.
 */
function loadedFirst(
  assets: NonNullable<PageMeasure['assets']>,
  fetcher: SiteFetcher
): SiteFetcher {
  const loaded = new Map(assets.map((asset) => [asset.url, asset]))
  return async (address, kind, limits) => {
    const asset = loaded.get(address)
    if (!asset) return fetcher(address, kind, limits)
    const body = Uint8Array.from(Buffer.from(asset.data, 'base64'))
    if (body.byteLength > limits.maxBytes) return null
    return { status: 200, url: address, contentType: asset.mime, body }
  }
}

/**
 * The app icon among those the rendered page declares, fetched through the
 * guarded fetcher and verified as the static reader's is. A site that walls
 * off the static reader still names its icons on the page the browser saw.
 */
async function appIcon(
  icons: NonNullable<PageMeasure['icons']>,
  pageUrl: string,
  fetcher: SiteFetcher
): Promise<BrandRead['icon']> {
  if (icons.length === 0) return undefined
  const asset = await readAppIcon(icons, pageUrl, (address) =>
    fetcher(address, 'image', { maxBytes: ICON_MAX_BYTES, timeoutMs: LOGO_TIMEOUT_MS })
  ).catch(() => null)
  return asset
    ? {
        raster: { bytes: asset.bytes, mime: asset.mime },
        widthPx: asset.width,
        heightPx: asset.height,
      }
    : undefined
}

export function browserBrandReader(opts: BrowserReaderOptions): BrandReader {
  const fetcher = opts.fetcher ?? liveSiteFetcher
  const endpoint = new URL('/read', opts.url).href
  const budget = opts.timeoutMs ?? TIMEOUT_MS

  async function ask(url: string, signal: AbortSignal): Promise<Response> {
    return fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
      redirect: 'error',
    })
  }

  return {
    name: 'browser',
    async read(url): Promise<BrandReaderResult> {
      const started = Date.now()
      const unreachable = (why: string, extra: Record<string, unknown> = {}) => {
        log.warn({ why, ms: Date.now() - started, ...extra }, 'browser read failed')
        return { failed: 'unreachable' } as const
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), budget)
      try {
        let res = await ask(url, controller.signal)
        if (RETRY_STATUSES.has(res.status)) {
          await res.body?.cancel().catch(() => undefined)
          res = await ask(url, controller.signal)
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined)
          return unreachable('status', { status: res.status })
        }
        const text = await cappedText(res)
        if (text === null) return unreachable('too_large')
        let json: unknown
        try {
          json = JSON.parse(text)
        } catch {
          return unreachable('not_json')
        }
        const reply = replySchema.safeParse(json)
        if (!reply.success) return unreachable('invalid_reply')
        const measure = reply.data.measure
        // Not the site's own page: an error or maintenance page, a bot check or a country picker.
        const brandLike =
          Boolean(measure.logo) ||
          (measure.candidates ?? measure.buttons).some(
            (button) => !('overlay' in button && button.overlay)
          )
        const kind = measure.page
          ? pageKind({ ...measure.page, title: measure.title, brandLike })
          : 'page'
        // An older sidecar's own word for a wall stands alone. With the page's
        // signs it is believed only of a page with nothing of the brand on it:
        // a real page with an invisible captcha on its form is not a wall.
        const walled = Boolean(measure.wall) && (!measure.page || (kind === 'page' && !brandLike))
        if (walled || kind === 'bot') {
          log.info({ ms: Date.now() - started }, 'browser read a bot check')
          return { failed: 'challenge' }
        }
        if (kind !== 'page') {
          log.info(
            { ms: Date.now() - started, kind, status: measure.page?.status ?? null },
            'browser read a page that is not the site'
          )
          return kind === 'picker'
            ? { failed: 'picker', links: measure.page?.links ?? [], pageUrl: url }
            : { failed: 'error' }
        }
        // The bytes the browser already loaded, where a fetch of our own could meet a bot check.
        const assetsFirst = loadedFirst(reply.data.measure.assets ?? [], fetcher)
        const { logo: drawn, ...read } = brandReadFromMeasure(reply.data.measure)
        const logo =
          drawn && reply.data.measure.logo
            ? await verifiedLogo(reply.data.measure.logo, read, assetsFirst)
            : undefined
        // The site's own dark-mode logo, verified as the logo is.
        const darkShown = logo ? reply.data.measure.darkLogo : undefined
        const darkVerified = darkShown
          ? await verifiedLogo(darkShown, read, assetsFirst).catch(() => undefined)
          : undefined
        const darkLogo = darkVerified && darkShown ? { ...darkVerified, how: darkShown.from } : null
        const icon = await appIcon(reply.data.measure.icons ?? [], url, assetsFirst)
        // The text font's files and the headings', read and classed by their own bytes.
        const classed = (font: PageMeasure['siteFont']) =>
          font
            ? classifySiteFont({
                ...font,
                files: font.files.map(({ data, ...file }) => ({
                  ...file,
                  bytes: Uint8Array.from(Buffer.from(data, 'base64')),
                })),
              })
            : undefined
        const siteFont = classed(reply.data.measure.siteFont)
        const siteHeadingFont = classed(reply.data.measure.headingFont)
        const outcome = (font: BrandRead['siteFont']) =>
          font ? ('notCopied' in font ? font.notCopied : font.licence) : null
        log.info(
          {
            ms: Date.now() - started,
            logo: logo?.from ?? null,
            icon: Boolean(icon),
            font: outcome(siteFont),
            headingFont: outcome(siteHeadingFont),
          },
          'browser read'
        )
        // An unusable logo or icon is left out, so the static reader's can stand.
        return {
          read: {
            ...read,
            ...(logo ? { logo } : {}),
            ...(darkLogo ? { darkLogo } : {}),
            ...(icon ? { icon } : {}),
            ...(siteFont ? { siteFont } : {}),
            ...(siteHeadingFont ? { siteHeadingFont } : {}),
          },
        }
      } catch (err) {
        return unreachable(controller.signal.aborted ? 'timeout' : 'request_failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

const isHttpUrl = (value: string) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * The browser reader when both its URL and token are set; otherwise none, and
 * Import reads statically. A setting it cannot use is logged and ignored
 * rather than failing imports.
 */
export function browserReaderFrom(settings: {
  url?: string
  token?: string
}): BrandReader | undefined {
  if (!settings.url || !settings.token) return undefined
  if (!isHttpUrl(settings.url) || settings.token.length < MIN_TOKEN_LENGTH) {
    log.warn(
      'QUACKBACK_BROWSER_URL must be an http(s) URL and QUACKBACK_BROWSER_TOKEN at least 16 characters; using the static reader'
    )
    return undefined
  }
  return browserBrandReader({ url: settings.url, token: settings.token })
}
