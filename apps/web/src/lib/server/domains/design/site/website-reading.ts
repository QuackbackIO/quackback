/**
 * read_website for the edit loop: a site's capture (cache first, a new one
 * within the workspace's limits) and its facts, said as the tool's result
 * (shared/design/agent/website-tool.ts), with the capture as a picture for
 * the model. A refusal or a limit is a value in the result, never an error.
 */
import { and, gt, isNotNull } from 'drizzle-orm'
import { db, siteCaptures } from '@/lib/server/db'
import { websiteReadingSchema, type WebsiteReading } from '@/lib/shared/design/agent/website-tool'
import { siteFontPlan, type FontResolution } from '../ai/brand-site'
import {
  CAPTURE_FRESH_MS,
  getSiteCapture,
  type SiteCaptureResult,
  type StoredAsset,
} from './capture-service'
import { shotFromCapture } from './capture-shots'
import type { FontFact, SiteFacts } from './types'

type Fallback = NonNullable<WebsiteReading['status']['fallback']>

const KIND: Record<StoredAsset['mime'], 'svg' | 'png' | 'jpeg' | 'webp' | 'gif' | 'ico' | 'avif'> =
  {
    'image/svg+xml': 'svg',
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/x-icon': 'ico',
    'image/avif': 'avif',
  }

const assetOf = (stored: StoredAsset | undefined) =>
  stored
    ? {
        from: stored.from,
        kind: KIND[stored.mime],
        key: stored.key,
        width: stored.width,
        height: stored.height,
        agrees: null,
      }
    : null

function fontOf(fact: FontFact | null, r: FontResolution | null) {
  if (!fact || !r) return null
  return {
    family: r.family.slice(0, 80),
    from: fact.from.slice(0, 80),
    how: r.how === 'nearest' && r.open ? ('open' as const) : r.how,
    id: r.id,
    why: r.why.slice(0, 300),
  }
}

/** A site's facts as the tool says them. */
export function factsOf(facts: SiteFacts | null, assets: Record<string, StoredAsset> | null) {
  if (!facts) return null
  const plan = siteFontPlan(facts)
  return {
    name: facts.name?.slice(0, 120) ?? null,
    language: facts.language?.slice(0, 20) ?? null,
    description: facts.description?.slice(0, 300) ?? null,
    themeColour: facts.themeColour,
    colours: facts.colours.slice(0, 12).map((c) => ({ hex: c.hex, from: c.from.slice(0, 80) })),
    fonts: {
      heading: fontOf(facts.fonts.heading ?? facts.fonts.body, plan.heading),
      body: fontOf(facts.fonts.body, plan.body),
    },
    logo: assetOf(assets?.logo),
    favicon: assetOf(assets?.favicon),
    shareImage: assetOf(assets?.share),
  }
}

/** The capture service's result, as the tool says it. */
export function readingOf(result: SiteCaptureResult): WebsiteReading {
  if (result.ok)
    return websiteReadingSchema.parse({
      ok: true,
      host: result.host,
      status: {
        source: result.cached ? 'cache' : 'capture',
        fallback: null,
        message: null,
        capturesLeftToday: result.usage.workspaceDayLeft,
      },
      facts: factsOf(result.facts, result.assets),
    })
  const fallback: Fallback = result.reason
  return websiteReadingSchema.parse({
    ok: false,
    host: result.host,
    status: { source: 'none', fallback, message: result.message, capturesLeftToday: null },
    facts: factsOf(result.facts, null),
  })
}

/** read_website: the reading, and the capture as the model sees it. */
export async function readWebsite(
  url: string,
  principalId: Parameters<typeof getSiteCapture>[0]['principalId']
): Promise<{ reading: WebsiteReading; capture: string | null }> {
  const result = await getSiteCapture({ url, principalId, loadImage: true })
  const shot = result.ok && result.image.png ? shotFromCapture(result.image.png) : null
  return { reading: readingOf(result), capture: shot?.jpeg ?? null }
}

/**
 * The site images this workspace has stored from captures still kept, which
 * the edit loop's model may place by their keys (and no others).
 */
export async function storedSiteImages(now = Date.now()): Promise<Set<string>> {
  const rows = await db
    .select({ assets: siteCaptures.assets })
    .from(siteCaptures)
    .where(
      and(
        isNotNull(siteCaptures.assets),
        gt(siteCaptures.capturedAt, new Date(now - CAPTURE_FRESH_MS))
      )
    )
  const keys = new Set<string>()
  for (const row of rows)
    for (const asset of Object.values((row.assets as Record<string, StoredAsset> | null) ?? {}))
      if (asset?.key) keys.add(asset.key)
  return keys
}
