/**
 * Server function: unfurl an external URL into a link preview.
 *
 * Security layers (in order):
 * 1. Auth required (admin | member | user)
 * 2. Non-team callers must hold portal access
 * 3. `linkPreviews` feature flag must be on
 * 4. Internal Quackback URLs are excluded (handled by quackbackEmbed)
 * 5. Per-principal rate limit: 30 requests / 60 s
 * 6. Redis cache (24h positives, 10min negatives)
 * 7. All outbound fetches via safeFetch (see unfurl.ts)
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { requireAuth } from './auth-helpers'
import { isTeamMember } from '@/lib/shared/roles'
import { parseEmbedUrl } from '@/lib/shared/embeds/parse-embed-url'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { cacheGet, cacheSet, getRedis } from '@/lib/server/redis'
import { getClientIp } from '@/lib/server/domains/api/rate-limit'
import type { LinkPreview } from '@/lib/server/content/unfurl'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'link-preview' })

const RATE_LIMIT_WINDOW_S = 60
// Per-principal cap. A per-IP cap (below) backs it up because an attacker can
// mint fresh anonymous principals cheaply, which would otherwise reset this key.
const RATE_LIMIT_MAX = 30
// Per-client-IP cap — bounds aggregate outbound fetches from one source even as
// it rotates anonymous principals, so the endpoint can't be a fetch-proxy/amp.
const RATE_LIMIT_IP_MAX = 60

/** Sentinel stored in Redis when a URL yields no preview (negative cache). */
interface NoneCache {
  __none: true
}

function urlCacheKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex')
  return `linkpreview:v1:${hash}`
}

export const unfurlLinkFn = createServerFn({ method: 'GET' })
  .validator(z.object({ url: z.string().url().max(2048) }))
  .handler(async ({ data }): Promise<LinkPreview | null> => {
    try {
      // 1. Auth
      const ctx = await requireAuth()

      // 2. Portal access gate for non-team callers
      if (!isTeamMember(ctx.principal.role)) {
        const { resolvePortalAccessForRequest } = await import('./portal-access')
        const access = await resolvePortalAccessForRequest()
        if (!access.granted) return null
      }

      // 3. Feature flag — read via the domain service, which parses the
      //    featureFlags text column and merges defaults. The raw settings row
      //    holds the unparsed JSON string, so reading the flag off it directly
      //    always fails.
      const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
      if (!(await isFeatureEnabled('linkPreviews'))) return null

      // 4. Exclude internal Quackback URLs
      if (parseEmbedUrl(data.url) !== null) return null

      // 5. Rate limit (best-effort; failures don't block the request). Cap per
      //    principal AND per client IP — the per-IP cap holds even when an
      //    attacker rotates cheap anonymous principals.
      try {
        const redis = getRedis()
        const ip = getClientIp(getRequestHeaders())
        const checks: Array<[string, number]> = [
          [`linkpreview:rl:p:${ctx.principal.id}`, RATE_LIMIT_MAX],
          [`linkpreview:rl:ip:${ip}`, RATE_LIMIT_IP_MAX],
        ]
        for (const [key, max] of checks) {
          const count = await redis.incr(key)
          // Set expiry on first hit; later hits in the window don't reset it.
          if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW_S)
          if (count > max) return null
        }
      } catch {
        // Redis unavailable — allow the request through
      }

      // 6. Cache lookup
      const cacheKey = urlCacheKey(data.url)
      const cached = await cacheGet<LinkPreview | NoneCache>(cacheKey)
      if (cached !== null) {
        if ('__none' in cached) return null
        return cached as LinkPreview
      }

      // 7. Fetch + unfurl
      const { unfurlExternalUrl } = await import('@/lib/server/content/unfurl')
      const result = await unfurlExternalUrl(data.url)

      // Cache: 24h for real previews, 10min for negatives (avoid hammering)
      await cacheSet(cacheKey, result ?? { __none: true }, result ? 86_400 : 600)

      return result
    } catch (err) {
      log.error({ err }, 'unfurl link failed')
      return null
    }
  })
