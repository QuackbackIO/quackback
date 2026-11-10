/**
 * The portal's drawn brand images at /brand.png: the share card (with a
 * page's name when asked) and the brand icon fitted into a square for the
 * favicon. Each address carries a version of what it shows, so the current
 * one is cached for good, by browsers and here; an old address still gets
 * today's image, cached briefly. A card is drawn once per version per
 * workspace and kept in a small in-memory cache.
 */
import { logger } from '@/lib/server/logger'
import { WorkspaceKeyedCache } from '@/lib/server/workspaces/workspace-keyed'
import { designAssetUrl } from '@/lib/shared/design/design-view'
import { resolveDesign } from '@/lib/shared/design/resolve'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  isShareCardPage,
  shareCardFacts,
  shareCardVersion,
  shortHash,
} from '@/lib/shared/design/share-card'
import { portalHeadWords, portalSiteName, type PortalHeadSettings } from '@/lib/shared/portal-head'
import { nameInitial } from '@/lib/shared/utils/initial'
import { decodeImage, type Image } from '../extract/image'
import { drawInitialTile, drawShareCard, drawSquareIcon, encodeShareCard } from './render'

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

/** A stored image's pixels, or null when it is missing or not a PNG or JPEG. */
async function pixels(deps: BrandImageDeps, key: string): Promise<Image | null> {
  const bytes = await deps.readObject(key)
  if (!bytes) return null
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

  if (query.get('kind') === 'icon') {
    // No icon, or an SVG one (mail cannot show it and there is no rasteriser
    // here): the initial tile, as the header and the card draw it.
    if (!facts.iconKey || isSvg(facts.iconKey)) {
      const title = portalSiteName(settings)
      const version = `${shareCardVersion(facts)}${shortHash(title)}`
      const key = `tile:${version}`
      const kept = cache.get(key)
      if (kept) return png(kept, asked === version)
      const bytes = encodeShareCard(
        drawInitialTile({ ...facts, initial: nameInitial(title) }, ICON_SIDE)
      )
      cache.set(key, bytes)
      return png(bytes, asked === version)
    }
    const version = shortHash(facts.iconKey)
    const key = `icon:${version}`
    const kept = cache.get(key)
    if (kept) return png(kept, asked === version)
    const icon = await pixels(deps, facts.iconKey)
    // An icon this cannot read (an ICO or WebP) is served as it is stored.
    if (!icon)
      return new Response(null, {
        status: 302,
        headers: { Location: designAssetUrl(facts.iconKey), 'Cache-Control': BRIEFLY },
      })
    const bytes = encodeShareCard(drawSquareIcon(icon, ICON_SIDE))
    cache.set(key, bytes)
    return png(bytes, asked === version)
  }

  const page = query.get('page')
  const shownPage = isShareCardPage(page) ? page : null
  const title = portalSiteName(settings)
  const version = `${shareCardVersion(facts)}${shortHash(title)}`
  const key = `card:${version}:${shownPage ?? ''}`
  const kept = cache.get(key)
  if (kept) return png(kept, asked === version)

  const started = performance.now()
  const icon = facts.iconKey ? await pixels(deps, facts.iconKey) : null
  const bytes = encodeShareCard(
    drawShareCard({
      ...facts,
      title,
      pageName: shownPage ? portalHeadWords(settings).pages[shownPage] : null,
      icon,
    })
  )
  cache.set(key, bytes)
  log.debug({ ms: Math.round(performance.now() - started), page: shownPage }, 'share card drawn')
  return png(bytes, asked === version)
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
