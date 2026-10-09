import { parseIconLinks, parseOpenGraph, type IconLink } from './og-parse'
import { fetchFollowingRedirects, fetchVerifiedImage, type VerifiedImage } from './unfurl'
import { imageDimensions, type ImageDimensions } from './image-dimensions'
import { uploadImageBuffer } from '@/lib/server/storage/s3'
import { safeWebsiteBrandColor } from '@/lib/shared/website-brand-color'
import { isStandardWebsiteUrl, parseWebsiteInput } from '@/lib/shared/website-branding'

/**
 * `good` logos are applied automatically. `weak` ones (an ICO, anything under
 * 64px, or a social banner) are only offered.
 */
export type WebsiteLogoQuality = 'good' | 'weak'

export interface WebsiteBranding {
  domain: string
  logoKey: string
  logoUrl: string
  quality: WebsiteLogoQuality
  color: string | null
}

type CandidateSource = 'icon' | 'social'
interface LogoCandidate {
  url: string
  source: CandidateSource
  rank: number
}

const IMAGE_TIMEOUT_MS = 10_000
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
/** All image fetches for one lookup share this budget. */
const IMAGE_BUDGET_MS = 25_000
const MAX_IMAGE_FETCHES = 5
/** Larger images are refused rather than shown as a logo. */
const MAX_LOGO_SIDE = 4096
/** A good logo is at least this large on its shorter side. */
const MIN_GOOD_SIDE = 64
/** Touch icons are published at 180px when no size is declared. */
const TOUCH_ICON_SIZE = 180

function extension(url: string): string {
  try {
    return /\.([a-z0-9]+)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase() ?? ''
  } catch {
    return ''
  }
}

/** Lower ranks are fetched first; null means the icon is never fetched. */
function iconRank(icon: IconLink): number | null {
  const ext = extension(icon.url)
  if (icon.type?.includes('svg') || ext === 'svg') return null
  const size = icon.size ?? (icon.touch ? TOUCH_ICON_SIZE : null)
  const pngOrWebp =
    icon.type === 'image/png' || icon.type === 'image/webp' || ext === 'png' || ext === 'webp'
  // A large PNG or WebP first, larger before smaller.
  if (size !== null && size >= 128 && (pngOrWebp || (!icon.type && ext === '')))
    return 1 - Math.min(size, MAX_LOGO_SIDE) / (MAX_LOGO_SIDE + 1)
  if (size !== null && size >= MIN_GOOD_SIDE) return 2
  if (size === null) return 3
  return 4
}

/** Logo candidates in the order they are fetched, deduplicated and capped. */
export function rankLogoCandidates(
  icons: IconLink[],
  pageUrl: string,
  socialImageUrl: string | null
): LogoCandidate[] {
  const candidates: LogoCandidate[] = []
  for (const icon of icons) {
    const rank = iconRank(icon)
    if (rank !== null) candidates.push({ url: icon.url, source: 'icon', rank })
  }
  candidates.push({
    url: new URL('/apple-touch-icon.png', pageUrl).href,
    source: 'icon',
    rank: 2.5,
  })
  candidates.push({ url: new URL('/favicon.ico', pageUrl).href, source: 'icon', rank: 5 })
  if (socialImageUrl) candidates.push({ url: socialImageUrl, source: 'social', rank: 6 })
  const seen = new Set<string>()
  return candidates
    .sort((a, b) => a.rank - b.rank)
    .filter((candidate) => !seen.has(candidate.url) && Boolean(seen.add(candidate.url)))
    .slice(0, MAX_IMAGE_FETCHES)
}

export function logoQuality(
  source: CandidateSource,
  image: VerifiedImage,
  size: ImageDimensions
): WebsiteLogoQuality {
  if (source === 'social' || image.mime === 'image/x-icon') return 'weak'
  return Math.min(size.width, size.height) >= MIN_GOOD_SIDE ? 'good' : 'weak'
}

/**
 * Fetch a website's homepage through the safe unfurl path and store its best
 * logo. The first good candidate wins; otherwise the first weak one is kept.
 * Only the chosen image is uploaded, and logos are never hotlinked.
 */
export async function fetchWebsiteBranding(site: string): Promise<WebsiteBranding | null> {
  try {
    const parsed = parseWebsiteInput(site)
    if (!parsed) return null
    const fetched = await fetchFollowingRedirects(parsed.origin + '/', {
      allowUrl: isStandardWebsiteUrl,
    })
    if (
      !fetched?.response.ok ||
      !fetched.response.headers.get('content-type')?.toLowerCase().startsWith('text/html')
    )
      return null
    const html = await fetched.response.text()
    const metadata = parseOpenGraph(html, fetched.finalUrl)
    const candidates = rankLogoCandidates(
      parseIconLinks(html, fetched.finalUrl),
      fetched.finalUrl,
      metadata.imageUrl
    )
    const deadline = Date.now() + IMAGE_BUDGET_MS
    let chosen: { image: VerifiedImage; quality: WebsiteLogoQuality } | null = null
    for (const candidate of candidates) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const image = await fetchVerifiedImage(candidate.url, {
        timeoutMs: Math.min(IMAGE_TIMEOUT_MS, remaining),
        maxBytes: IMAGE_MAX_BYTES,
        followRedirects: true,
        allowUrl: isStandardWebsiteUrl,
      })
      const size = image && imageDimensions(image.buffer, image.mime)
      if (!image || !size || size.width > MAX_LOGO_SIDE || size.height > MAX_LOGO_SIDE) continue
      const quality = logoQuality(candidate.source, image, size)
      if (quality === 'good') {
        chosen = { image, quality }
        break
      }
      chosen ??= { image, quality }
    }
    if (!chosen) return null
    const stored = await uploadImageBuffer(chosen.image.buffer, chosen.image.mime, 'logos', {
      contentAddressed: true,
    })
    return {
      domain: parsed.hostname.toLowerCase(),
      logoKey: stored.key,
      logoUrl: stored.url,
      quality: chosen.quality,
      color: safeWebsiteBrandColor(metadata.themeColor),
    }
  } catch {
    return null
  }
}
