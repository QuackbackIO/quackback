/**
 * Off-host leaves for stored asset refs.
 *
 * Persist stores host-independent `/api/storage/<key>` (private: `?read=`).
 * Email, widget, OG, and other callers that leave the workspace origin
 * absolutize here from the immutable system host. A friendly platform URL or
 * the request Host must never be baked into contentJson.
 *
 * Legacy absolute srcs stay accepted: this rewrites `/api/storage/…` onto the
 * system host at send/render time and leaves CDN / foreign URLs untouched.
 * It does not rewrite the fleet.
 */
import { config } from '@/lib/server/config'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

export function isStoredAssetPath(pathname: string): boolean {
  return pathname.startsWith('/api/storage/') && pathname.length > '/api/storage/'.length
}

/**
 * The stored object key a persist ref (or a legacy absolute `/api/storage`
 * URL) names, or null if `src` is not one.
 *
 * Absolute srcs on an old hostname still name a key: the host is not the
 * workspace boundary. `..` and undecodable escapes are refused the same way
 * the storage route refuses them.
 */
export function storedAssetKeyFromSrc(src: string): string | null {
  if (!src) return null
  try {
    const parsed = new URL(src, 'https://placeholder.invalid')
    if (!isStoredAssetPath(parsed.pathname)) return null
    const key = decodeURIComponent(parsed.pathname.slice('/api/storage/'.length))
    return key && !key.includes('..') ? key : null
  } catch {
    return null
  }
}

/**
 * Origin of the pinned system-host storage URL (`https://ws-…/api/storage`).
 * CDN-style publicUrl values are not a system host and are ignored.
 */
export function systemHostOriginFromPublicUrl(publicUrl: string | undefined | null): string | null {
  if (!publicUrl) return null
  try {
    const parsed = new URL(publicUrl)
    if (parsed.pathname.replace(/\/$/, '') !== '/api/storage') return null
    return parsed.origin
  } catch {
    return null
  }
}

/** Immutable origin used to absolutize stored refs at off-host leaves. */
export function getSystemAssetOrigin(): string {
  const workspace = getCurrentWorkspace()
  if (workspace) {
    const pinned = systemHostOriginFromPublicUrl(workspace.storage.publicUrl)
    if (pinned) return pinned
    return workspace.routing.baseUrl.replace(/\/$/, '')
  }
  return config.baseUrl.replace(/\/$/, '')
}

/**
 * The separate origin user files are served from (`USER_CONTENT_URL`), or
 * null to serve them from the app's own origin.
 *
 * Null under a workspace scope whatever the setting says: the storage route
 * resolves the workspace from the Host header, so one shared host would name
 * no workspace. The config getter already drops it under pooled tenancy; this
 * holds the same line for any scope.
 */
export function userContentOrigin(): string | null {
  if (getCurrentWorkspace()) return null
  try {
    return config.userContentUrl ?? null
  } catch {
    // The configuration is validated at boot, so this only fails outside a
    // booted process (a build, a unit test), where there is no setting to honour.
    return null
  }
}

/**
 * A stored `/api/storage/…` ref as a browser should load it: on the
 * user-content origin when one is configured, unchanged otherwise.
 *
 * Read time only. What a message stores stays host-independent, so the
 * setting can be turned off or moved without rewriting anything. Absolute and
 * foreign URLs are never rewritten.
 */
export function toUserContentUrl(src: string): string {
  if (!src.startsWith('/api/storage/') || !storedAssetKeyFromSrc(src)) return src
  const origin = userContentOrigin()
  return origin ? `${origin}${src}` : src
}

/**
 * Hosts that may legally appear on a stored `/api/storage/…` URL for this
 * workspace: the system pin, every routing hostname, the process base, and
 * the user-content origin when one is configured.
 */
export function trustedStorageHosts(): Set<string> {
  const hosts = new Set<string>()
  const addOrigin = (value: string | undefined | null) => {
    if (!value) return
    try {
      hosts.add(new URL(value).hostname.toLowerCase())
    } catch {
      // ignore unparseable pins
    }
  }
  const addHost = (value: string | undefined | null) => {
    if (value) hosts.add(value.toLowerCase().replace(/\.$/, ''))
  }

  addOrigin(config.baseUrl)
  addOrigin(userContentOrigin())
  const workspace = getCurrentWorkspace()
  if (workspace) {
    addOrigin(workspace.routing.baseUrl)
    addOrigin(systemHostOriginFromPublicUrl(workspace.storage.publicUrl) ?? undefined)
    for (const hostname of workspace.routing.hostnames) addHost(hostname)
  }
  return hosts
}

export function absolutizeOffHostAssetUrl(src: string, opts?: { email?: boolean }): string {
  if (!src) return src
  const alreadyAbsolute = src.startsWith('http://') || src.startsWith('https://')
  if (alreadyAbsolute) {
    try {
      const parsed = new URL(src)
      if (!isStoredAssetPath(parsed.pathname)) return src
    } catch {
      return src
    }
  }
  const origin = getSystemAssetOrigin()
  try {
    const parsed = new URL(src, `${origin}/`)
    if (isStoredAssetPath(parsed.pathname)) {
      const rewritten = new URL(parsed.pathname + parsed.search, `${origin}/`)
      if (opts?.email && !rewritten.searchParams.has('email')) {
        rewritten.searchParams.set('email', '1')
      }
      return rewritten.toString()
    }
    if (alreadyAbsolute) return src
    return parsed.toString()
  } catch {
    return src
  }
}
