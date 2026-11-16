/**
 * Origins Better Auth will accept for CSRF / Origin checks.
 *
 * Pooled workspaces list every hostname on the registry record: system,
 * friendly platform, redirects, and ready custom hosts. The list is read
 * from the request scope, not snapshotted when the auth instance is first
 * built — a custom domain added after the first sign-in would otherwise
 * keep 403ing "Invalid origin" until auth_config_version happened to bump.
 *
 * Every routable section host (help.acme.com for the help center) is added on
 * top, on a single-workspace install and on Cloud alike: a sign-in posted from
 * that host, and a callback URL back to it, must pass. Only the hosts links and
 * routing would send a visitor to count (`getSectionOrigins`): verified and
 * on, and on Cloud a custom domain that is ready.
 *
 * Process-wide TRUSTED_ORIGINS is only for a single-workspace install.
 * Honouring it under pooled tenancy would trust one workspace's origin on
 * every other workspace in the process.
 */
import { config } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'

const WILDCARD_HOST_RE = /[*?]/

export function originsForWorkspaceHostnames(baseUrl: string, hostnames: string[]): string[] {
  let protocol = 'https:'
  let baseOrigin: string | null = null
  try {
    const parsed = new URL(baseUrl)
    protocol = parsed.protocol
    baseOrigin = parsed.origin
  } catch {
    baseOrigin = null
  }
  const origins = new Set<string>()
  if (baseOrigin) origins.add(baseOrigin)
  for (const raw of hostnames) {
    const host = raw.trim().toLowerCase().split(':')[0] ?? ''
    if (!host || host.includes('/') || WILDCARD_HOST_RE.test(host)) continue
    origins.add(`${protocol}//${host}`)
  }
  return [...origins]
}

/**
 * Better Auth `trustedOrigins` callback. Invoked per request.
 *
 * Does not fetch: the request scope already holds the registry record
 * (Host / signed customer-host lookup ran before auth). Adding a custom
 * domain updates that record; the next request sees the new origin.
 */
export function workspaceAuthTrustedOrigins(
  request?: Request,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const workspace = getCurrentWorkspace()
  if (workspace) {
    const origins = originsForWorkspaceHostnames(
      workspace.routing.baseUrl || config.baseUrl,
      workspace.routing.hostnames
    )
    return withMatchingRequestOrigin(origins, request, workspace.routing.hostnames)
  }
  const extra = (env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return [...originsForWorkspaceHostnames(config.baseUrl, []), ...extra]
}

function withMatchingRequestOrigin(
  origins: string[],
  request: Request | undefined,
  hostnames: string[]
): string[] {
  if (!request) return origins
  const raw = request.headers.get('origin')
  if (!raw) return origins
  let origin: URL
  try {
    origin = new URL(raw)
  } catch {
    return origins
  }
  const host = origin.hostname.toLowerCase()
  const allowed = new Set(hostnames.map((h) => h.trim().toLowerCase().split(':')[0] ?? ''))
  if (!allowed.has(host)) return origins
  if (origins.includes(origin.origin)) return origins
  return [...origins, origin.origin]
}

/**
 * The Better Auth `trustedOrigins` callback: the workspace's own origins and
 * its routable section hosts. The settings read is memoised per request; a
 * failure to read them leaves the base list, so sign-in on the primary domain
 * never depends on the section map.
 */
export async function authTrustedOrigins(
  request?: Request,
  env: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  const base = workspaceAuthTrustedOrigins(request, env)
  try {
    const { getSectionOrigins } = await import('@/lib/server/domains/settings/section-links')
    const origins = await getSectionOrigins()
    return [...new Set([...base, ...Object.values(origins)])]
  } catch (err) {
    logger
      .child({ component: 'auth-trusted-origins' })
      .warn({ err }, 'section hosts not read; trusting the workspace origins only')
    return base
  }
}
