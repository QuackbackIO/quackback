/**
 * The files a page read hands back beside its measurements, as the browser
 * has them: the logo's image and the app icons, a logo's symbols kept in
 * another file's sprite, and an icon that is a drawing turned into a picture.
 * Each is the response the browser already received (a bot check that served
 * the browser may refuse a second fetch), else a fetch from inside the page.
 */
import { rankAppIcons } from '../site/app-icon'
import { drawSquareIcon, inlineSprites, spriteFiles, svgIconUrls } from './read-helpers'
import type { PageMeasure } from './page-measure'

const ASSET_FETCH_MS = 2_500
const ASSET_MAX_BYTES = 400 * 1024
/** The logo and icons together; the font files have their own cap, each. */
const ASSETS_MAX_BYTES = 1_000 * 1024
const MAX_ICON_ASSETS = 3

export interface LoadedResponse {
  requestId: string
  status: number
  mime: string
}

/** The logo's image and the app icons worth trying, in that order. */
export function assetUrls(measure: PageMeasure, pageUrl: string): string[] {
  const logo = [measure.logo?.src, measure.darkLogo?.src].filter(
    (src): src is string => typeof src === 'string' && /^https?:/.test(src)
  )
  const icons = rankAppIcons(measure.icons ?? [], pageUrl)
    .filter((icon) => !icon.endsWith('/favicon.ico'))
    .slice(0, MAX_ICON_ASSETS)
  return [...new Set([...logo, ...icons])]
}

/**
 * The images at `urls` as this browser has them: the response it already
 * received (a bot check that served the browser may refuse a second fetch),
 * else a fetch from inside the page, which carries the visit's session. Each
 * capped, all capped, base64; whatever cannot be had is left for the app to fetch.
 */
export async function loadedAssets(
  view: Bun.WebView,
  urls: string[],
  responses: Map<string, LoadedResponse>
): Promise<NonNullable<PageMeasure['assets']>> {
  const assets: NonNullable<PageMeasure['assets']> = []
  let total = 0
  for (const url of urls) {
    const asset = await loadedBody(view, url, responses, ASSET_MAX_BYTES)
    if (!asset || asset === 'too-large') continue
    const bytes = Math.ceil((asset.data.length * 3) / 4)
    if (total + bytes > ASSETS_MAX_BYTES) continue
    total += bytes
    assets.push({ url, ...asset })
  }
  return assets
}

/** An inline logo past this is not sent (as the page's own measure holds it). */
const LOGO_SVG_MAX_CHARS = 300_000
const MAX_SPRITE_FILES = 2
/** The side a drawn icon is turned into a picture at. */
const DRAWN_ICON_PX = 256

/**
 * An inline logo that draws from another file's sprite, with its symbols
 * brought in from the file as the browser loaded it. Unchanged when it uses
 * none, or the file cannot be had.
 */
export async function withSprites(
  view: Bun.WebView,
  svg: string,
  pageUrl: string,
  responses: Map<string, LoadedResponse>
): Promise<string> {
  const files = new Map<string, string>()
  for (const file of spriteFiles(svg, pageUrl).slice(0, MAX_SPRITE_FILES)) {
    const body = await loadedBody(view, file, responses, ASSET_MAX_BYTES)
    if (body && body !== 'too-large') files.set(file, Buffer.from(body.data, 'base64').toString())
  }
  if (files.size === 0) return svg
  const drawn = inlineSprites(svg, files, pageUrl)
  return drawn.length <= LOGO_SVG_MAX_CHARS ? drawn : svg
}

/**
 * The declared icons that are drawings, each turned into a square picture the
 * app can use as an icon: a site whose only icon is an SVG still has one.
 * One that will not draw, or is not square, stays as it was, and so does
 * the logo's own file when it is declared as an icon too.
 */
export async function drawnIcons(
  view: Bun.WebView,
  measure: PageMeasure,
  assets: NonNullable<PageMeasure['assets']>
): Promise<void> {
  const drawings = new Set(
    svgIconUrls(measure.icons ?? [], [measure.logo?.src, measure.darkLogo?.src])
  )
  for (const asset of assets) {
    if (!drawings.has(asset.url) || /^image\/(?:png|jpeg|webp)/i.test(asset.mime)) continue
    const source = `data:image/svg+xml;base64,${asset.data}`
    const png = (await Promise.race([
      view
        .evaluate(`(${drawSquareIcon.toString()})(${JSON.stringify(source)}, ${DRAWN_ICON_PX})`)
        .catch(() => null),
      Bun.sleep(ASSET_FETCH_MS).then(() => null),
    ])) as string | null
    if (typeof png === 'string' && png.length > 0) {
      asset.mime = 'image/png'
      asset.data = png
    }
  }
}

/** The response this browser already received for `url`, as text or base64. */
export async function receivedBody(
  view: Bun.WebView,
  url: string,
  responses: Map<string, LoadedResponse>
): Promise<{ mime: string; body: string; base64: boolean } | null> {
  const seen = responses.get(url)
  if (!seen || seen.status !== 200) return null
  const body = await view
    .cdp<{ body: string; base64Encoded: boolean }>('Network.getResponseBody', {
      requestId: seen.requestId,
    })
    .catch(() => null)
  return body ? { mime: seen.mime, body: body.body, base64: body.base64Encoded } : null
}

/**
 * One file as this browser has it, base64: the response it received, else a
 * fetch from inside the page. Null when it cannot be had; `too-large` past `max`.
 */
export async function loadedBody(
  view: Bun.WebView,
  url: string,
  responses: Map<string, LoadedResponse>,
  max: number
): Promise<{ mime: string; data: string } | 'too-large' | null> {
  const received = await receivedBody(view, url, responses)
  const asset: { mime: string; data: string } | 'too-large' | null = received
    ? {
        mime: received.mime,
        data: received.base64 ? received.body : Buffer.from(received.body).toString('base64'),
      }
    : await Promise.race([
        view
          .evaluate(`(${fetchInPage.toString()})(${JSON.stringify(url)}, ${max})`)
          .then((value) => value as { mime: string; data: string } | 'too-large' | null)
          .catch(() => null),
        Bun.sleep(ASSET_FETCH_MS).then(() => null),
      ])
  if (!asset || asset === 'too-large') return asset
  return Math.ceil((asset.data.length * 3) / 4) > max ? 'too-large' : asset
}

/** Runs in the page: one file fetched with the visit's session, base64, or null. */
async function fetchInPage(
  url: string,
  max: number
): Promise<{ mime: string; data: string } | 'too-large' | null> {
  try {
    const res = await fetch(url, { credentials: 'include' })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length > max) return 'too-large'
    let text = ''
    for (let i = 0; i < bytes.length; i += 32768)
      text += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return { mime: res.headers.get('content-type') || '', data: btoa(text) }
  } catch {
    return null
  }
}
