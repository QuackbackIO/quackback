/**
 * Beacon ingestion for visitor analytics.
 *
 * Fire-and-forget by contract: every outcome, including invalid, rate-limited,
 * or opted-out input, is silently dropped and the route answers 204 either
 * way. Raw IP and User-Agent are consumed transiently to rate-limit, filter
 * bots, derive coarse device fields, and compute the daily-salted visitor
 * hash; neither is ever persisted.
 */
import { z } from 'zod'
import Bowser from 'bowser'
import { isbot } from 'isbot'
import { db, pageViews } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import { incrementBucket } from '@/lib/server/utils/redis-rate-bucket'
import { captureCountryFromHeaders } from '@/lib/server/auth/country-capture'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { getDailySalt, computeVisitorHash } from './visitor-hash'

const log = logger.child({ component: 'visitor-track' })

const MAX_BODY_BYTES = 2048
const BEACONS_PER_MINUTE_PER_IP = 120

interface ParsedUa {
  device: string | null
  browser: string | null
  os: string | null
}

// UA strings repeat heavily across a visitor's pageviews; cache the parse so
// repeat beacons skip Bowser's regex walk. Bounded FIFO eviction.
const uaCache = new Map<string, ParsedUa>()
const UA_CACHE_MAX = 500

function parseUserAgent(userAgent: string): ParsedUa {
  const cached = uaCache.get(userAgent)
  if (cached) return cached
  let parsed: ParsedUa = { device: null, browser: null, os: null }
  try {
    const parser = Bowser.getParser(userAgent)
    parsed = {
      device: parser.getPlatformType() || 'desktop',
      browser: parser.getBrowserName() || null,
      os: parser.getOSName() || null,
    }
  } catch {
    // Unparseable UA: keep nulls, the row is still countable.
  }
  if (uaCache.size >= UA_CACHE_MAX) {
    uaCache.delete(uaCache.keys().next().value as string)
  }
  uaCache.set(userAgent, parsed)
  return parsed
}

const beaconSchema = z.object({
  url: z.string().max(2000),
  referrer: z.string().max(2000).optional().default(''),
  surface: z.enum(['portal', 'widget']),
  /** Layer-2 durable id; an untrusted opaque token, length-capped. */
  deviceId: z.string().max(128).optional(),
})

/**
 * Source classification: explicit campaign params win, then the external
 * referrer's hostname; same-origin referrers are internal navigation and
 * count as direct. Query strings are read here and then discarded — only
 * the pathname is ever stored.
 */
function deriveSource(url: URL, referrer: string): string | null {
  const campaign =
    url.searchParams.get('utm_source') ??
    url.searchParams.get('source') ??
    url.searchParams.get('ref')
  if (campaign) return campaign.slice(0, 100)
  if (!referrer) return null
  try {
    const ref = new URL(referrer)
    return ref.hostname === url.hostname ? null : ref.hostname
  } catch {
    return null
  }
}

/** Ingest one beacon. Never throws; the caller always answers 204. */
export async function recordPageView(request: Request): Promise<void> {
  // Opt-out signals win before anything else is read.
  if (request.headers.get('dnt') === '1' || request.headers.get('sec-gpc') === '1') return
  if (!(await isFeatureEnabled('visitorAnalytics'))) return

  const userAgent = request.headers.get('user-agent') ?? ''
  if (!userAgent || isbot(userAgent)) return

  const ip = getClientIp(request)
  const { count } = await incrementBucket({ key: `track:${ip}`, windowSeconds: 60 })
  if (count !== null && count > BEACONS_PER_MINUTE_PER_IP) return

  const raw = await request.text()
  if (!raw || raw.length > MAX_BODY_BYTES) return
  let beacon: z.infer<typeof beaconSchema>
  try {
    beacon = beaconSchema.parse(JSON.parse(raw))
  } catch {
    return
  }

  let url: URL
  try {
    url = new URL(beacon.url)
  } catch {
    return
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return

  const salt = await getDailySalt()
  if (!salt) return
  const visitorHash = computeVisitorHash({ salt, siteOrigin: url.origin, ip, userAgent })

  const { device, browser, os } = parseUserAgent(userAgent)

  try {
    await db.insert(pageViews).values({
      siteOrigin: url.origin,
      surface: beacon.surface,
      path: url.pathname,
      source: deriveSource(url, beacon.referrer),
      country: captureCountryFromHeaders(request.headers),
      device,
      browser,
      os,
      visitorHash,
      deviceId: beacon.deviceId ?? null,
    })
  } catch (error) {
    // Most likely a missing day partition (maintenance job not running).
    log.error({ err: error }, 'pageview insert failed, dropping')
  }
}
