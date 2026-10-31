/**
 * A website's wordmark and share image, fetched and stored for a design the
 * AI starts from it. The header logo is a wordmark when it draws clearly
 * wider than it is tall; a square one is a mark, which the workspace logo
 * already covers. An SVG is stored only when it holds nothing that runs. The
 * share image is kept when it is a photo large enough for a band; whether it
 * suits one (a picture, not words and a logo) is the model's call.
 *
 * Files are named by their content, so starting again from the same site
 * stores nothing new. Fetched as the website reader fetches: SSRF-guarded,
 * with an honest agent.
 */
import { createHash } from 'node:crypto'
import { fetchFollowingRedirects } from '@/lib/server/content/unfurl'
import { logger } from '@/lib/server/logger'
import { isS3Usable, uploadObject } from '@/lib/server/storage/s3'
import { isStandardWebsiteUrl } from '@/lib/shared/website-branding'
import { imageSize, safeSvg, svgAspect, svgColours } from './site-logo'
import type { SiteSignals } from './site-signals'

const log = logger.child({ module: 'site-assets' })

const AGENT = 'Mozilla/5.0 (compatible; QuackbackBrandReader/1.0; +https://quackback.io)'
/** Wider than this for its height reads as a wordmark. */
export const WORDMARK_ASPECT = 1.8
const LOGO_BYTES = 1024 * 1024
const SHARE_BYTES = 3 * 1024 * 1024
const SHARE_MIN = { width: 600, height: 300 }
const RASTER = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export interface SiteAssets {
  /** The stored wordmark, and its own colours for status markers. */
  wordmark: { key: string; colours: string[] } | null
  /** The stored share image, with its bytes for the model to look at. */
  shareImage: { key: string; mimeType: string; base64: string } | null
}

/** A file's type from its first bytes, not from what the server says. */
function sniff(bytes: Uint8Array): string | null {
  const head = String.fromCharCode(...bytes.subarray(0, 16))
  if (head.startsWith('\x89PNG')) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (head.startsWith('GIF8')) return 'image/gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'image/webp'
  const text = new TextDecoder().decode(bytes.subarray(0, 2048)).trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg\b/i.test(text)) return 'image/svg+xml'
  return null
}

async function fetchFile(url: string, maxBytes: number) {
  const fetched = await fetchFollowingRedirects(url, {
    allowUrl: isStandardWebsiteUrl,
    headers: { accept: 'image/*,*/*;q=0.5', 'user-agent': AGENT },
    timeoutMs: 8000,
    maxBytes,
  }).catch(() => null)
  if (!fetched || fetched.response.status >= 400) return null
  const bytes = new Uint8Array(await fetched.response.arrayBuffer().catch(() => new ArrayBuffer(0)))
  const type = bytes.length > 0 ? sniff(bytes) : null
  return type ? { bytes, type } : null
}

async function store(prefix: string, bytes: Uint8Array, type: string): Promise<string> {
  const ext = type === 'image/svg+xml' ? 'svg' : type.split('/')[1]!
  const key = `${prefix}/site-${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${ext}`
  await uploadObject(key, bytes, type)
  return key
}

async function importWordmark(signals: SiteSignals): Promise<SiteAssets['wordmark']> {
  const logo = signals.logo
  if (!logo) return null
  let svg: string | null = null
  let raster: { bytes: Uint8Array; type: string } | null = null
  if ('svg' in logo) svg = logo.svg
  else {
    const file = await fetchFile(logo.url, LOGO_BYTES)
    if (file?.type === 'image/svg+xml') svg = new TextDecoder().decode(file.bytes)
    else if (file && (RASTER as readonly string[]).includes(file.type)) raster = file
  }
  if (svg !== null) {
    const safe = safeSvg(svg)
    if (!safe || (svgAspect(safe) ?? 0) < WORDMARK_ASPECT) return null
    const bytes = new TextEncoder().encode(safe)
    return { key: await store('header-logos', bytes, 'image/svg+xml'), colours: svgColours(safe) }
  }
  const size = raster ? imageSize(raster.bytes) : null
  if (!raster || !size || size.width / size.height < WORDMARK_ASPECT) return null
  return { key: await store('header-logos', raster.bytes, raster.type), colours: [] }
}

async function importShareImage(signals: SiteSignals): Promise<SiteAssets['shareImage']> {
  if (!signals.shareImage) return null
  const file = await fetchFile(signals.shareImage, SHARE_BYTES)
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return null
  const size = imageSize(file.bytes)
  if (!size || size.width < SHARE_MIN.width || size.height < SHARE_MIN.height) return null
  return {
    key: await store('portal-images', file.bytes, file.type),
    mimeType: file.type,
    base64: Buffer.from(file.bytes).toString('base64'),
  }
}

/** What a website gives a design to use, stored; nothing where storage is not set up. */
export async function importSiteAssets(signals: SiteSignals): Promise<SiteAssets> {
  if (!isS3Usable()) return { wordmark: null, shareImage: null }
  const [wordmark, shareImage] = await Promise.all([
    importWordmark(signals).catch((err: unknown) => {
      log.warn({ err, domain: signals.domain }, 'website wordmark could not be stored')
      return null
    }),
    importShareImage(signals).catch((err: unknown) => {
      log.warn({ err, domain: signals.domain }, 'website share image could not be stored')
      return null
    }),
  ])
  log.info(
    { domain: signals.domain, wordmark: !!wordmark, shareImage: !!shareImage },
    'website assets imported for a design'
  )
  return { wordmark, shareImage }
}
