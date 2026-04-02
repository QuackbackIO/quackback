import { createServerFn } from '@tanstack/react-start'

// --- Semver comparison (exported for testing) ---

export function isNewerVersion(current: string, latest: string): boolean {
  const [cMajor, cMinor, cPatch] = current.split('.').map(Number)
  const [lMajor, lMinor, lPatch] = latest.split('.').map(Number)
  if (lMajor !== cMajor) return lMajor > cMajor
  if (lMinor !== cMinor) return lMinor > cMinor
  return lPatch > cPatch
}

// --- In-memory cache ---

interface VersionCache {
  data: LatestVersionResult
  expiresAt: number
}

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
let versionCache: VersionCache | null = null

// --- Types ---

export interface LatestVersionResult {
  version: string
  releaseUrl: string
}

// --- Server function ---

export const getLatestVersion = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LatestVersionResult | null> => {
    // Return cached result if fresh
    if (versionCache && Date.now() < versionCache.expiresAt) {
      return versionCache.data
    }

    try {
      const res = await fetch(
        'https://api.github.com/repos/QuackbackIO/quackback/releases/latest',
        {
          headers: { Accept: 'application/vnd.github.v3+json' },
        }
      )

      if (!res.ok) {
        console.warn(`[fn:version] GitHub API returned ${res.status}`)
        return null
      }

      const release = (await res.json()) as { tag_name: string; html_url: string }
      const version = release.tag_name.replace(/^v/, '')

      const data: LatestVersionResult = {
        version,
        releaseUrl: release.html_url,
      }

      versionCache = { data, expiresAt: Date.now() + CACHE_TTL_MS }
      return data
    } catch (err) {
      console.warn(`[fn:version] Failed to fetch latest release:`, (err as Error).message)
      return null
    }
  }
)
