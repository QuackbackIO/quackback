/**
 * The custom domain while it is paused after the plan limits grace.
 *
 * A request on a custom hostname gets a temporary redirect (307, never
 * cached) to the workspace's own hostname, same path and query, and every link
 * generated meanwhile (`config.baseUrl`: email, the widget SDK, sitemaps)
 * names that hostname. The domain records are never touched, so the custom
 * hostname serves again the moment the plan includes it.
 *
 * A portal section's own host (help.acme.com) is the exception: it keeps
 * serving its section in place. The primary domain sends a section's paths
 * there with a permanent redirect that browsers cache, so sending that host
 * back would loop. While paused, the section map reads it as not verified
 * (`withoutPausedHosts`): the primary domain serves the section's paths
 * itself, no link, canonical, sitemap or robots.txt names the host, and the
 * team's pages on it still go to the primary domain. Sign-in and sign-out
 * still trust it, since it still serves.
 *
 * Host resolution runs before any workspace scope exists, so the decision is
 * made by a request middleware that runs right after it, inside the scope,
 * and before the section host middleware, which reads what it decided.
 *
 * Only a safe, top-level read is redirected. Left in place:
 *  - every other method, so a form posted before the pause still lands;
 *  - `/api/*` (the widget's calls, the REST API, MCP and inbound webhooks: a
 *    redirect would drop their CORS answer or their credentials), except a
 *    navigation to `/api/auth/*`, so a sign-in link or callback minted on the
 *    custom hostname still lands;
 *  - `/.well-known/*` discovery documents and server functions;
 *  - the `/widget` frame, so an embed whose SDK was loaded before the pause
 *    keeps the frame origin it talks to. A fresh SDK names the default host.
 *
 * Sessions are host cookies, so people signed in on the custom hostname sign
 * in again on the default one.
 */
import { configuredBaseUrl } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import {
  runWithPausedCustomDomain,
  setRequestPausedCustomDomain,
  type PausedCustomDomainView,
} from '@/lib/server/base-url-override'
import { getCurrentWorkspace } from '@/lib/server/workspaces/workspace-context'
import { requestWorkspaceHost } from '@/lib/server/workspaces/saas-edge-host'
import { readPlanLimitsSources } from '@/lib/server/domains/settings/settings.plan-limits'
import { parseIdentityProjection } from '@/lib/server/domains/settings/cloud/identity-projection'
import { isFeaturePaused } from './plan-limits.service'

const log = logger.child({ component: 'plan-limits-domain' })

export interface PausedCustomDomain {
  /** The workspace's own origin, which serves while the custom domain is paused. */
  defaultOrigin: string
  /** Every lower-case custom hostname: links never name these while paused. */
  customHostnames: ReadonlySet<string>
  /** The custom hostnames that redirect to the default origin (not a section's). */
  redirectHostnames: ReadonlySet<string>
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * The paused custom domain, or null when it serves (or there is none, or no
 * default hostname is known to send people to). Reads the cached settings row;
 * the plan state is read only when a custom hostname is set up. Fails open.
 */
export async function pausedCustomDomain(): Promise<PausedCustomDomain | null> {
  try {
    const sources = await readPlanLimitsSources()
    if (!sources) return null
    const identity = parseIdentityProjection(sources.cloudIdentity)
    const custom = new Set<string>()
    for (const domain of identity?.customDomains ?? []) custom.add(domain.hostname.toLowerCase())
    for (const hostname of sources.sectionHostnames) custom.add(hostname)
    if (custom.size === 0) return null

    const workspace = getCurrentWorkspace()
    let defaultHost = identity?.platformHostname?.toLowerCase() ?? null
    if (!defaultHost) {
      // No platform hostname: the configured origin is the default when it is
      // not itself one of the custom hostnames.
      const base = hostOf(workspace?.routing.baseUrl ?? configuredBaseUrl())
      defaultHost = base && !custom.has(base) ? base : null
    }
    if (!defaultHost) return null
    // Under pooled routing, send people only to a hostname that routes here.
    if (workspace && !workspace.routing.hostnames.some((h) => h.toLowerCase() === defaultHost)) {
      return null
    }
    custom.delete(defaultHost)
    if (custom.size === 0) return null

    if (!(await isFeaturePaused('customDomain'))) return null
    const redirectHostnames = new Set(custom)
    for (const hostname of sources.sectionHostnames) redirectHostnames.delete(hostname)
    return { defaultOrigin: `https://${defaultHost}`, customHostnames: custom, redirectHostnames }
  } catch (err) {
    log.error({ err }, 'paused custom domain check failed; serving as usual')
    return null
  }
}

/** Whether a request on a paused custom hostname is redirected (see the module doc). */
function redirectable(request: Request, pathname: string): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (pathname.startsWith('/api/')) {
    // Only a navigation: a script's fetch (the widget frame's token call)
    // cannot follow a cross-origin redirect with its credentials.
    const mode = request.headers.get('sec-fetch-mode')
    return pathname.startsWith('/api/auth/') && (mode === null || mode === 'navigate')
  }
  if (pathname.startsWith('/.well-known/') || pathname.startsWith('/_serverFn')) return false
  if (pathname === '/widget' || pathname.startsWith('/widget/')) return false
  return true
}

/** Paths that belong to the fleet: probed constantly, never read settings for them. */
function isFleetPath(pathname: string): boolean {
  return pathname.startsWith('/api/health') || pathname.startsWith('/api/internal/')
}

/**
 * The request middleware: redirect a paused custom hostname, and generate
 * links on the default hostname for the rest of the request. Framework-free so
 * it can be tested against a plain Request.
 */
export async function handlePausedCustomDomain<T>({
  request,
  next,
}: {
  request: Request
  next: () => Promise<T>
}): Promise<T | Response> {
  const url = new URL(request.url)
  if (isFleetPath(url.pathname)) return next()
  const paused = await pausedCustomDomain()
  if (!paused) return next()

  const host = requestWorkspaceHost(request)?.toLowerCase() ?? null
  if (host && paused.redirectHostnames.has(host) && redirectable(request, url.pathname)) {
    return new Response(null, {
      status: 307,
      headers: {
        location: `${paused.defaultOrigin}${url.pathname}${url.search}`,
        'cache-control': 'no-store',
      },
    })
  }
  setRequestPausedCustomDomain(pausedView(paused))
  return next()
}

/**
 * What the rest of the work reads: links on the default hostname when the
 * configured origin is itself a paused custom hostname, and every paused
 * hostname left out of links and routing.
 */
function pausedView(paused: PausedCustomDomain): PausedCustomDomainView {
  const configuredIsCustom = paused.customHostnames.has(hostOf(configuredBaseUrl()) ?? '')
  return {
    origin: configuredIsCustom ? paused.defaultOrigin : null,
    hostnames: [...paused.customHostnames],
  }
}

/** Run background work (an email, a notification) with links on the default hostname while paused. */
export async function withPausedCustomDomainOrigin<T>(fn: () => Promise<T>): Promise<T> {
  const paused = await pausedCustomDomain()
  if (!paused) return fn()
  return runWithPausedCustomDomain(pausedView(paused), fn)
}
