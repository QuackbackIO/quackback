import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'github-star-count' })

const REPO_API_URL = 'https://api.github.com/repos/QuackbackIO/quackback'
const CACHE_TTL_MS = 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 1500
const FAILURE_RETRY_MS = 5 * 60 * 1000

interface Options {
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>
  now?: () => number
}

/**
 * The repo's star count for the star prompt's button. The same host the
 * update check already reads, cached for an hour; on any failure the button
 * simply shows no count.
 */
export function createStarCountReader({ fetcher = fetch, now = Date.now }: Options = {}) {
  let cached: { stars: number; expiresAt: number } | null = null
  let lastFailureAt: number | null = null

  return async function readStarCount(): Promise<number | null> {
    if (cached && now() < cached.expiresAt) return cached.stars
    if (lastFailureAt !== null && now() - lastFailureAt < FAILURE_RETRY_MS) {
      return cached?.stars ?? null
    }
    try {
      const res = await fetcher(REPO_API_URL, {
        headers: { Accept: 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`github api returned ${res.status}`)
      const body = (await res.json()) as { stargazers_count?: unknown }
      if (typeof body.stargazers_count !== 'number') throw new Error('no star count')
      cached = { stars: body.stargazers_count, expiresAt: now() + CACHE_TTL_MS }
      lastFailureAt = null
      return cached.stars
    } catch (err) {
      log.debug({ err }, 'could not read the github star count')
      lastFailureAt = now()
      return cached?.stars ?? null
    }
  }
}

export const readStarCount = createStarCountReader()
