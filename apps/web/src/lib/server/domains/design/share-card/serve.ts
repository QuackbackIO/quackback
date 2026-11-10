/**
 * The portal's drawn brand images at /brand.png: the share card (with a
 * page's name when asked) and the brand icon fitted into a square for the
 * favicon. Each address carries a version of what it shows, so the current
 * one is cached for good, by browsers and here; an old address still gets
 * today's image, cached briefly. A card is drawn once per version per
 * workspace and kept in a small in-memory cache.
 */
import { logger } from '@/lib/server/logger'
import {
  currentWorkspaceNamespace,
  WorkspaceKeyedCache,
} from '@/lib/server/workspaces/workspace-keyed'
import { designAssetUrl, designView } from '@/lib/shared/design/design-view'
import { resolveDesign } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  cardCanDraw,
  isShareCardPage,
  shareCardAddressVersion,
  shortHash,
} from '@/lib/shared/design/share-card'
import {
  shareCardFacts,
  shareCardVersion,
  type ShareCardFacts,
} from '@/lib/shared/design/share-card-facts'
import { portalHeadWords, portalSiteName, type PortalHeadSettings } from '@/lib/shared/portal-head'
import { resolvePortalOgImageUrl } from '@/lib/shared/portal-og-image'
import { nameInitial } from '@/lib/shared/utils/initial'
import { decodeImage, type Image } from '../extract/image'
import { CARD, drawInitialTile, drawShareCard, drawSquareIcon, encodeShareCard } from './render'
import { rasteriseSvg } from './svg'

const log = logger.child({ module: 'share-card' })

export interface BrandImageDeps {
  /** The design the portal draws now, and the settings its head reads; null without one. */
  load: () => Promise<{ doc: PortalDesign; settings: PortalHeadSettings } | null>
  /** A stored file's bytes, or null when it cannot be read. */
  readObject: (key: string) => Promise<Uint8Array | null>
}

/** The favicon's side, in px: sharp at every size a browser asks for. */
const ICON_SIDE = 256
/** The most images kept; a card is about 30 KB. */
const CACHE_ENTRIES = 64
const FOREVER = 'public, max-age=31536000, immutable'
const BRIEFLY = 'public, max-age=300'

/** Drawn images by version, each workspace's apart from the others'. */
const cache = new WorkspaceKeyedCache<Uint8Array>(CACHE_ENTRIES)

/**
 * Draws under way, by the cache's key in its workspace: requests for one
 * image while it is drawn share that draw, so a burst of them (a link
 * shared, a page of favicons) draws it once instead of once each.
 */
const drawing = new Map<string, Promise<Uint8Array | null>>()

/** The image kept under `key`, else drawn once however many ask meanwhile, and kept. */
function drawnOnce(key: string, draw: () => Promise<Uint8Array | null>): Promise<Uint8Array | null> {
  const kept = cache.get(key)
  if (kept) return Promise.resolve(kept)
  const at = `${currentWorkspaceNamespace()}|${key}`
  const pending = drawing.get(at)
  if (pending) return pending
  const run = draw()
    .then((bytes) => {
      if (bytes) cache.set(key, bytes)
      return bytes
    })
    .finally(() => drawing.delete(at))
  drawing.set(at, run)
  return run
}

function png(bytes: Uint8Array, current: boolean): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': current ? FOREVER : BRIEFLY,
      Vary: 'Host',
    },
  })
}

const notFound = () => new Response('Not found', { status: 404 })

const isSvg = (key: string) => /\.svg$/i.test(key)

/**
 * A stored image's pixels, or null when it is missing or not a PNG, JPEG or
 * SVG this can draw. An SVG is drawn with its longest side at `side`.
 */
async function pixels(
  deps: Pick<BrandImageDeps, 'readObject'>,
  key: string,
  side: number
): Promise<Image | null> {
  const bytes = await deps.readObject(key)
  if (!bytes) return null
  if (isSvg(key)) return rasteriseSvg(bytes, side)
  try {
    return decodeImage(bytes)
  } catch {
    return null
  }
}

export async function serveBrandImage(
  query: URLSearchParams,
  deps: BrandImageDeps
): Promise<Response> {
  const loaded = await deps.load()
  if (!loaded) return notFound()
  const { doc, settings } = loaded
  const asked = query.get('v') ?? ''
  const facts = shareCardFacts(doc, resolveDesign(doc))

  const kind = query.get('kind')
  if (kind === 'icon' || kind === 'logo') {
    const square = await brandSquare(deps, facts, portalSiteName(settings), kind)
    if ('redirect' in square)
      return new Response(null, {
        status: 302,
        headers: { Location: square.redirect, 'Cache-Control': BRIEFLY },
      })
    return png(square.bytes, asked === square.version)
  }

  const page = query.get('page')
  const shownPage = isShareCardPage(page) ? page : null
  const title = portalSiteName(settings)
  const pageName = shownPage ? portalHeadWords(settings).pages[shownPage] : null
  const version = shareCardAddressVersion(shareCardVersion(facts), title, pageName)
  const key = `card:${version}:${shownPage ?? ''}`
  const bytes = await drawnOnce(key, async () => {
    const started = performance.now()
    const drawn = await drawCard(deps, facts, title, pageName)
    log.debug({ ms: Math.round(performance.now() - started), page: shownPage }, 'share card drawn')
    return drawn
  })
  return bytes ? png(bytes, asked === version) : notFound()
}

/** A drawn square of the brand, with the version its address carries; or where a stored icon is. */
type BrandSquare = { bytes: Uint8Array; version: string } | { redirect: string }

/**
 * The brand fitted into a square, as the favicon and email headers show it:
 * for `logo`, the full logo when the design has one; else the icon, drawn
 * when stored as SVG; else the initial tile of the title, as the header and
 * the card draw it. Each is kept by version.
 */
async function brandSquare(
  deps: Pick<BrandImageDeps, 'readObject'>,
  facts: ShareCardFacts,
  title: string,
  kind: 'icon' | 'logo'
): Promise<BrandSquare> {
  const drawn = async (key: string, version: string, imageKey: string) => {
    const bytes = await drawnOnce(key, async () => {
      const image = await pixels(deps, imageKey, ICON_SIDE)
      return image ? encodeShareCard(drawSquareIcon(image, ICON_SIDE)) : null
    })
    return bytes ? { bytes, version } : null
  }
  // The full logo for email headers, fitted into their square; an SVG drawn to PNG.
  if (kind === 'logo' && facts.logoKey) {
    const version = shortHash(facts.logoKey)
    const logo = await drawn(`logo:${version}`, version, facts.logoKey)
    if (logo) return logo
  }
  if (facts.iconKey) {
    const version = shortHash(facts.iconKey)
    const icon = await drawn(`icon:${version}`, version, facts.iconKey)
    if (icon) return icon
    // An icon this cannot read (an ICO or WebP) is served as it is stored;
    // an SVG it cannot draw takes the initial tile, as mail cannot show SVG.
    if (!isSvg(facts.iconKey)) return { redirect: designAssetUrl(facts.iconKey) }
  }
  // No icon: the initial tile, as the header and the card draw it.
  const version = `${shareCardVersion(facts)}${shortHash(title)}`
  const key = `tile:${version}`
  const bytes = await drawnOnce(key, async () =>
    encodeShareCard(drawInitialTile({ ...facts, initial: nameInitial(title) }, ICON_SIDE))
  )
  return { bytes: bytes!, version }
}

const dataUrl = (bytes: Uint8Array) =>
  `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`

/**
 * The brand's square as /brand.png would draw it with this design
 * published, for the publish review's email sample: a PNG data URL, so the
 * sample shows the draft's icon, logo or initial and never the live one.
 */
export async function brandSquareSample(
  doc: PortalDesign,
  title: string,
  kind: 'icon' | 'logo',
  deps: Pick<BrandImageDeps, 'readObject'>
): Promise<string> {
  const square = await brandSquare(deps, shareCardFacts(doc, resolveDesign(doc)), title, kind)
  return 'redirect' in square ? square.redirect : dataUrl(square.bytes)
}

/** The card as a PNG: the design's facts, its icon read from storage, the title and page name. */
async function drawCard(
  deps: Pick<BrandImageDeps, 'readObject'>,
  facts: ShareCardFacts,
  title: string,
  pageName: string | null
): Promise<Uint8Array> {
  const icon = facts.iconKey ? await pixels(deps, facts.iconKey, CARD.icon) : null
  // No icon: the full logo, when it has one, in place of the initial.
  const logo = !icon && facts.logoKey ? await pixels(deps, facts.logoKey, CARD.logo) : null
  return encodeShareCard(
    drawShareCard({ ...facts, title, pageName, icon: icon ?? logo, wide: !icon && !!logo })
  )
}

/**
 * What a link to the portal would show with this design published, for the
 * publish review: the design's share image, else the card exactly as
 * /brand.png draws it (as a data URL), else, for a title the card cannot
 * draw, the logo the portal's head falls back to.
 */
export async function shareCardSample(
  doc: PortalDesign,
  settings: PortalHeadSettings,
  deps: Pick<BrandImageDeps, 'readObject'>
): Promise<string> {
  if (doc.brand.shareImage) return designAssetUrl(doc.brand.shareImage.key)
  const view = { ...settings, portalDesign: designView(doc, null) }
  const title = portalSiteName(view)
  if (!cardCanDraw(title)) return resolvePortalOgImageUrl(settings.brandingData)
  return dataUrl(await drawCard(deps, shareCardFacts(doc, resolveDesign(doc)), title, null))
}

/** The largest stored icon read, in bytes. */
const MAX_ICON_BYTES = 5 * 1024 * 1024

/** The deps as the portal runs them: the workspace's settings, its design and its storage. */
export function brandImageDeps(): BrandImageDeps {
  return {
    async load() {
      const [{ getWorkspaceSettings }, { getPublishedRevision }, engine, { config }] =
        await Promise.all([
          import('@/lib/server/domains/settings/settings.service'),
          import('@/lib/server/domains/design/design.service'),
          import('@/lib/server/domains/design/engine'),
          import('@/lib/server/config'),
        ])
      const settings = await getWorkspaceSettings()
      if (settings?.portalDesign?.engine !== 'v2') return null
      const source = engine.resolveDesignSource({
        override: config.portalDesignEngine,
        flagOn: true,
        published: await getPublishedRevision(),
        legacy: engine.legacyBrandingOf({
          ...(settings.settings as Record<string, never>),
          brandingConfig: settings.brandingConfig,
          portalConfig: settings.portalConfig,
        }),
      })
      return source.engine === 'v2' ? { doc: source.doc, settings } : null
    },
    async readObject(key) {
      const { getS3Object } = await import('@/lib/server/storage/s3')
      try {
        const object = await getS3Object(key)
        const reader = object.body.getReader()
        const chunks: Uint8Array[] = []
        let total = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > MAX_ICON_BYTES) {
            await reader.cancel().catch(() => {})
            return null
          }
          chunks.push(value)
        }
        const out = new Uint8Array(total)
        let at = 0
        for (const chunk of chunks) {
          out.set(chunk, at)
          at += chunk.byteLength
        }
        return out
      } catch (err) {
        log.warn({ err, key }, 'brand icon could not be read for the share card')
        return null
      }
    },
  }
}
