/**
 * A brand's website, captured and read for the brand match.
 *
 * One capture per host, kept in site_captures: a good capture for 30 days, a
 * failure for a day. Each new capture reads the site's code first (readSite)
 * and only then spends a ScreenshotOne call, within the usage limits
 * (capture-limits.ts). Without an access key nothing is captured, but the
 * site's code is still read, so the match always has the facts.
 *
 * The capture's PNG is stored privately (an unknown storage prefix is private)
 * under `site-captures/<host>/<capturedAt-ms>.png` when storage is usable.
 */
import { currentWorkspaceNamespace } from '@/lib/server/workspaces/workspace-keyed'
import type { PrincipalId } from '@quackback/ids'
import { db, eq, siteCaptures } from '@/lib/server/db'
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { checkUrlSafety } from '@/lib/server/content/ssrf-guard'
import { getS3Object, isS3Usable, uploadObject } from '@/lib/server/storage/s3'
import { siteHost } from './host'
import { takeCapture, type CaptureFailure, type FetchLike } from './screenshotone'
import {
  claimCall,
  recordCall,
  monthUsage,
  settleCall,
  usageLeft,
  type CaptureLimitName,
  type CaptureLimits,
  type CaptureUsageLeft,
} from './capture-limits'
import type { SiteAsset, SiteFacts, SiteRead } from './types'

const log = logger.child({ module: 'site-capture' })

const DAY_MS = 24 * 60 * 60 * 1000
/** How long a good capture is used before the site is captured again. */
export const CAPTURE_FRESH_MS = 30 * DAY_MS
/** How long a failure is remembered, and how soon a host can be captured again. */
export const FAILURE_FRESH_MS = DAY_MS

export interface CaptureDeps {
  fetch: FetchLike
  readSite: (url: string) => Promise<SiteRead>
  store: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>
  now: () => number
  keys: { accessKey: string | null; secretKey: string | null }
  /** The DNS-level SSRF check on the homepage URL. */
  checkUrl: (url: string) => Promise<boolean>
  /** Whether storage can hold the PNG; without it the bytes are returned but not kept. */
  canStore: () => boolean
  /** Overrides the configured limits (tests). */
  limits?: CaptureLimits
}

export type SiteCaptureFailure =
  | 'not_configured'
  | 'invalid_url'
  | 'blocked_url'
  | 'limit'
  | 'challenge'
  | 'capture_failed'
  | 'quota'
  | 'recapture_too_soon'

export type SiteCaptureResult =
  | {
      ok: true
      host: string
      url: string
      cached: boolean
      capturedAt: Date
      image: {
        key: string | null
        width: number
        height: number
        /** Only when just captured, or when asked for with `loadImage`. */
        png?: Uint8Array
      }
      facts: SiteFacts | null
      /** The site's favicon, logo and share picture as stored beside the capture. */
      assets: Record<string, StoredAsset> | null
      read?: SiteRead
      usage: CaptureUsageLeft
    }
  | {
      ok: false
      host: string | null
      reason: SiteCaptureFailure
      limit?: CaptureLimitName
      resetsAt?: Date
      facts: SiteFacts | null
      read?: SiteRead
      /** One plain sentence the builder can show the admin. */
      message: string
    }

export interface SiteCaptureInput {
  url: string
  principalId: PrincipalId | null
  /** Capture again even when a good capture is cached; once a day per host at most. */
  recapture?: boolean
  /** Read a cached capture's PNG back from storage. */
  loadImage?: boolean
}

const FALLBACK = "this match uses what the site's code says. Paste a screenshot for the look."

const MESSAGES: Record<Exclude<SiteCaptureFailure, 'limit'>, string> = {
  not_configured: `Site captures are not set up here, so ${FALLBACK}`,
  invalid_url: 'That does not look like a website address. Try one like example.com.',
  blocked_url: 'That address cannot be reached from here, so it was not captured.',
  challenge: `The site asked for a human check before showing itself, so ${FALLBACK}`,
  capture_failed: `The site could not be captured just now, so ${FALLBACK}`,
  quota: `Captures are used up for this month, so ${FALLBACK}`,
  recapture_too_soon:
    'This site was captured less than a day ago, so the last capture is used until then.',
}

const LIMIT_MESSAGES: Record<CaptureLimitName, string> = {
  user_hour: `You have used this hour's captures, so ${FALLBACK}`,
  workspace_day: `Today's captures are used up, so ${FALLBACK}`,
  workspace_month: `Captures are used up for this month, so ${FALLBACK}`,
  instance_month: `Captures are used up for this month, so ${FALLBACK}`,
}

/**
 * Concurrent requests for one host in one workspace share one capture. Keyed
 * by the workspace too: a capture is cached, counted and stored in the
 * workspace that asked, so another workspace never shares it.
 */
const inFlight = new Map<string, Promise<SiteCaptureResult>>()
const inFlightKey = (host: string) => `${currentWorkspaceNamespace()}|${host}`

/** Loads the site reader only when a site is read, keeping its module off this one's import graph. */
async function liveReadSite(url: string): Promise<SiteRead> {
  const { readSite, liveSiteFetcher } = await import('./site-read')
  return readSite(url, liveSiteFetcher)
}

/** The real dependencies, for whatever the caller did not pass. */
function resolveDeps(o: Partial<CaptureDeps>): CaptureDeps {
  return {
    fetch: o.fetch ?? ((url, init) => fetch(url, init)),
    readSite: o.readSite ?? liveReadSite,
    store:
      o.store ??
      (async (key, bytes, contentType) => {
        await uploadObject(key, bytes, contentType)
      }),
    now: o.now ?? (() => Date.now()),
    keys: o.keys ?? {
      accessKey: config.screenshotoneAccessKey ?? null,
      secretKey: config.screenshotoneSecretKey ?? null,
    },
    checkUrl: o.checkUrl ?? (async (url) => (await checkUrlSafety(url)).safe),
    canStore: o.canStore ?? (() => isS3Usable()),
    limits: o.limits,
  }
}

type CaptureRow = typeof siteCaptures.$inferSelect

export interface StoredAsset {
  key: string
  url: string
  mime: SiteAsset['mime']
  width: number
  height: number
  from: SiteAsset['from']
}

const ASSET_EXTENSIONS: Record<SiteAsset['mime'], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/x-icon': 'ico',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

function failure(
  host: string | null,
  reason: Exclude<SiteCaptureFailure, 'limit'>,
  read?: SiteRead | null,
  extra: { resetsAt?: Date; facts?: SiteFacts | null } = {}
): SiteCaptureResult {
  return {
    ok: false,
    host,
    reason,
    ...(extra.resetsAt ? { resetsAt: extra.resetsAt } : {}),
    facts: extra.facts ?? read?.facts ?? null,
    ...(read ? { read } : {}),
    message: MESSAGES[reason],
  }
}

/** Why a cached failure failed, as the builder sees it. */
function cachedFailureReason(reason: string | null): 'challenge' | 'quota' | 'capture_failed' {
  if (reason === 'challenge') return 'challenge'
  if (reason === 'quota') return 'quota'
  return 'capture_failed'
}

async function readSafely(deps: CaptureDeps, url: string): Promise<SiteRead> {
  try {
    return await deps.readSite(url)
  } catch (err) {
    log.warn({ err }, 'site read failed')
    return { facts: null, favicon: null, logo: null, shareImage: null, failed: 'fetch_failed' }
  }
}

async function upsertRow(values: typeof siteCaptures.$inferInsert): Promise<void> {
  const rest = values
  await db
    .insert(siteCaptures)
    .values(values)
    .onConflictDoUpdate({
      target: siteCaptures.host,
      set: {
        url: rest.url,
        status: rest.status,
        reason: rest.reason ?? null,
        imageKey: rest.imageKey ?? null,
        width: rest.width ?? null,
        height: rest.height ?? null,
        facts: rest.facts ?? null,
        assets: rest.assets ?? null,
        options: rest.options,
        capturedByPrincipalId: rest.capturedByPrincipalId ?? null,
        capturedAt: rest.capturedAt,
      },
    })
}

async function storeAssets(
  deps: CaptureDeps,
  host: string,
  stamp: number,
  read: SiteRead
): Promise<Record<string, StoredAsset> | null> {
  const stored: Record<string, StoredAsset> = {}
  const assets = { favicon: read.favicon, logo: read.logo, share: read.shareImage }
  for (const [name, asset] of Object.entries(assets)) {
    if (!asset) continue
    // The site's own images are public once a design shows them, as logos are; the capture stays private.
    const key = `logos/site/${host}/${stamp}-${name}.${ASSET_EXTENSIONS[asset.mime]}`
    try {
      await deps.store(key, asset.bytes, asset.mime)
      stored[name] = {
        key,
        url: asset.url,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        from: asset.from,
      }
    } catch (err) {
      log.warn({ err, host, asset: name }, 'site asset not stored')
    }
  }
  return Object.keys(stored).length > 0 ? stored : null
}

async function capture(input: SiteCaptureInput, deps: CaptureDeps): Promise<SiteCaptureResult> {
  const target = siteHost(input.url)
  if (!target) return failure(null, 'invalid_url')
  const { host, url } = target
  if (!(await deps.checkUrl(url))) return failure(host, 'blocked_url')

  const now = deps.now()
  const [row] = await db.select().from(siteCaptures).where(eq(siteCaptures.host, host)).limit(1)
  if (row) {
    const age = now - row.capturedAt.getTime()
    if (input.recapture) {
      if (age < FAILURE_FRESH_MS) {
        return failure(host, 'recapture_too_soon', null, {
          resetsAt: new Date(row.capturedAt.getTime() + FAILURE_FRESH_MS),
          facts: (row.facts as SiteFacts | null) ?? null,
        })
      }
    } else if (row.status === 'ok' && age < CAPTURE_FRESH_MS) {
      return cachedOk(row, input, deps, now)
    } else if (row.status === 'failed' && age < FAILURE_FRESH_MS) {
      return failure(host, cachedFailureReason(row.reason), null, {
        facts: (row.facts as SiteFacts | null) ?? null,
      })
    }
  }

  const accessKey = deps.keys.accessKey
  if (!accessKey) {
    // Nothing to capture with; the site's code is still worth reading.
    return failure(host, 'not_configured', await readSafely(deps, url))
  }

  const read = await readSafely(deps, url)
  if (read.failed === 'blocked_url') return failure(host, 'blocked_url', read)
  if (read.failed === 'challenge') {
    // A wall in front of the HTML is a wall in front of the browser too: no call.
    await upsertRow({
      host,
      url,
      status: 'failed',
      reason: 'challenge',
      facts: read.facts,
      options: { skipped: 'challenge' },
      capturedByPrincipalId: input.principalId,
      capturedAt: new Date(now),
    })
    return failure(host, 'challenge', read)
  }

  const claim = await claimCall({ host, principalId: input.principalId, now }, deps)
  if (!claim.ok) {
    return {
      ok: false,
      host,
      reason: 'limit',
      limit: claim.refusal.limit,
      resetsAt: claim.refusal.resetsAt,
      facts: read.facts,
      read,
      message: LIMIT_MESSAGES[claim.refusal.limit],
    }
  }

  const language = read.facts?.language ?? null
  const out = await takeCapture(url, {
    fetch: deps.fetch,
    keys: { accessKey, secretKey: deps.keys.secretKey },
    language,
  })
  const billed = out.ok || out.billed
  await settleCall(claim.id, { outcome: out.ok ? 'ok' : out.reason, billed })
  // A page that never went quiet was asked for twice: the first, timed out, is a call too.
  if (out.attempts === 2)
    await recordCall({ host, principalId: input.principalId, outcome: 'timeout', billed: false })
  const month = await monthUsage(now, deps)
  log.info(
    { host, outcome: out.ok ? 'ok' : out.reason, billed, monthCount: month.used },
    'site capture'
  )

  if (!out.ok) {
    const keepGood = row?.status === 'ok' && now - row.capturedAt.getTime() < CAPTURE_FRESH_MS
    // A failed recapture leaves a good capture in place.
    if (!keepGood) {
      await upsertRow({
        host,
        url,
        status: 'failed',
        reason: out.reason,
        facts: read.facts,
        options: { request: out.request, code: out.code },
        capturedByPrincipalId: input.principalId,
        capturedAt: new Date(now),
      })
    }
    return failure(host, failureReason(out.reason), read)
  }

  let imageKey: string | null = null
  let assets: Record<string, StoredAsset> | null = null
  if (deps.canStore()) {
    const key = `site-captures/${host}/${now}.png`
    try {
      await deps.store(key, out.png, 'image/png')
      imageKey = key
    } catch (err) {
      log.warn({ err, host }, 'site capture not stored')
    }
    assets = await storeAssets(deps, host, now, read)
  }
  await upsertRow({
    host,
    url,
    status: 'ok',
    reason: null,
    imageKey,
    width: out.width,
    height: out.height,
    facts: read.facts,
    assets,
    options: { request: out.request, language },
    capturedByPrincipalId: input.principalId,
    capturedAt: new Date(now),
  })
  return {
    ok: true,
    host,
    url,
    cached: false,
    capturedAt: new Date(now),
    image: { key: imageKey, width: out.width, height: out.height, png: out.png },
    facts: read.facts,
    assets,
    read,
    usage: await usageLeft(input.principalId, now, deps),
  }
}

function failureReason(reason: CaptureFailure): 'quota' | 'challenge' | 'capture_failed' {
  if (reason === 'quota') return 'quota'
  if (reason === 'challenge') return 'challenge'
  return 'capture_failed'
}

async function cachedOk(
  row: CaptureRow,
  input: SiteCaptureInput,
  deps: CaptureDeps,
  now: number
): Promise<SiteCaptureResult> {
  const png = input.loadImage && row.imageKey ? await loadCaptureImage(row.imageKey) : null
  return {
    ok: true,
    host: row.host,
    url: row.url,
    cached: true,
    capturedAt: row.capturedAt,
    image: {
      key: row.imageKey,
      width: row.width ?? 0,
      height: row.height ?? 0,
      ...(png ? { png } : {}),
    },
    facts: (row.facts as SiteFacts | null) ?? null,
    assets: (row.assets as Record<string, StoredAsset> | null) ?? null,
    usage: await usageLeft(input.principalId, now, deps),
  }
}

/**
 * A capture of the site at `input.url`: cached when fresh, else read and
 * captured within the usage limits. Never throws for the site's or the
 * provider's failures; those come back as `{ ok: false, reason, message }`.
 */
export async function getSiteCapture(
  input: SiteCaptureInput,
  overrides: Partial<CaptureDeps> = {}
): Promise<SiteCaptureResult> {
  const deps = resolveDeps(overrides)
  const host = siteHost(input.url)?.host
  if (!host) return capture(input, deps)
  const key = inFlightKey(host)
  const pending = inFlight.get(key)
  if (pending) return pending
  const run = capture(input, deps).finally(() => inFlight.delete(key))
  inFlight.set(key, run)
  return run
}

/** A stored capture's PNG, or null when it cannot be read. */
export async function loadCaptureImage(key: string): Promise<Uint8Array | null> {
  try {
    const object = await getS3Object(key)
    return new Uint8Array(await new Response(object.body).arrayBuffer())
  } catch (err) {
    log.warn({ err, key }, 'site capture image not readable')
    return null
  }
}

/** This month's captures against the monthly cap, for an admin surface. */
export async function captureUsage(
  now: number = Date.now(),
  opts: { limits?: CaptureLimits } = {}
): Promise<{ used: number; limit: number; month: string }> {
  const { used, limit } = await monthUsage(now, opts)
  return { used, limit, month: new Date(now).toISOString().slice(0, 7) }
}
