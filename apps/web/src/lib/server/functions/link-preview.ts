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
import { cacheGet, cacheSet, getRedis } from '@/lib/server/redis'
import type { LinkPreview } from '@/lib/server/content/unfurl'

const RATE_LIMIT_WINDOW_S = 60
const RATE_LIMIT_MAX = 30

/** Sentinel stored in Redis when a URL yields no preview (negative cache). */
interface NoneCache {
  __none: true
}

function urlCacheKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex')
  return `linkpreview:v1:${hash}`
}

function rlKey(principalId: string): string {
  return `linkpreview:rl:${principalId}`
}

export const unfurlLinkFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ url: z.string().url().max(2048) }))
  .handler(async ({ data }): Promise<LinkPreview | null> => {
    try {
      // 1. Auth
      const ctx = await requireAuth({ roles: ['admin', 'member', 'user'] })

      // 2. Portal access gate for non-team callers
      if (!isTeamMember(ctx.principal.role)) {
        const { resolvePortalAccessForRequest } = await import('./portal-access')
        const access = await resolvePortalAccessForRequest()
        if (!access.granted) return null
      }

      // 3. Feature flag
      const { getSettings } = await import('./workspace')
      const settings = await getSettings()
      const flags = settings?.featureFlags as { linkPreviews?: boolean } | undefined
      if (!flags?.linkPreviews) return null

      // 4. Exclude internal Quackback URLs
      if (parseEmbedUrl(data.url) !== null) return null

      // 5. Rate limit (best-effort; failures don't block the request)
      try {
        const redis = getRedis()
        const key = rlKey(ctx.principal.id)
        const count = await redis.incr(key)
        if (count === 1) {
          // Set expiry on first hit; subsequent hits within the window don't reset it.
          await redis.expire(key, RATE_LIMIT_WINDOW_S)
        }
        if (count > RATE_LIMIT_MAX) return null
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
      console.error('[fn:link-preview] unfurlLinkFn failed:', err)
      return null
    }
  })
