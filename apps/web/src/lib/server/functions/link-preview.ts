/**
 * Server function: unfurl an external URL into a link preview.
 *
 * Security layers (in order):
 * 1. Auth required (admin | member | user)
 * 2. Non-team callers must hold portal access
 * 3. `supportInbox` feature flag must be on (link previews ride the conversations product)
 * 4. Internal Quackback URLs are excluded (handled by quackbackEmbed)
 * 5. Per-principal rate limit: 30 requests / 60 s
 * 6. KV cache (24h positives, 10min negatives)
 * 7. All outbound fetches via safeFetch (see unfurl.ts)
 */

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { requireAuth } from './auth-helpers'
import { isTeamMember } from '@/lib/shared/roles'
import { parseEmbedUrl } from '@/lib/shared/embeds/parse-embed-url'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { cacheGet, cacheSet } from '@/lib/server/cache'
import { incrementBuckets } from '@/lib/server/utils/rate-bucket'
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

/** Sentinel stored in the cache when a URL yields no preview (negative cache). */
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
      if (!(await isFeatureEnabled('supportInbox'))) return null

      // 4. Exclude internal Quackback URLs
      if (parseEmbedUrl(data.url) !== null) return null

      // 5. Rate limit (best-effort; failures don't block the request). Cap per
      //    principal AND per client IP — the per-IP cap holds even when an
      //    attacker rotates cheap anonymous principals.
      const ip = getClientIp(getRequestHeaders())
      const caps = [RATE_LIMIT_MAX, RATE_LIMIT_IP_MAX]
      // One round trip for both buckets. `incrementBuckets` fails open (null
      // counts) on a store error, which is the behaviour the hand-rolled
      // try/catch here provided.
      const counts = await incrementBuckets([
        { key: `linkpreview:rl:p:${ctx.principal.id}`, windowSeconds: RATE_LIMIT_WINDOW_S },
        { key: `linkpreview:rl:ip:${ip}`, windowSeconds: RATE_LIMIT_WINDOW_S },
      ])
      for (const [i, count] of counts.entries()) {
        if (count !== null && count > caps[i]) return null
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
