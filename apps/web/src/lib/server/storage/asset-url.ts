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
 * Hosts that may legally appear on a stored `/api/storage/…` URL for this
 * workspace: the system pin, every routing hostname, and the process base.
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
