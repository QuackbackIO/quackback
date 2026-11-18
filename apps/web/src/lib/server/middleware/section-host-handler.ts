/**
 * Portal sections on their own hostnames (help.acme.com for the help center).
 * The framework binding is section-host.ts; this is the server-only part.
 *
 * Runs after workspace resolution, so the settings read is the workspace's.
 * The decision is `resolveSectionHostRoute` (lib/shared/section-domains.ts):
 *
 *  - `redirect`: answered here, with `Vary: Host, Cookie`, since the same path
 *    answers differently on each host. A visitor carrying a session cookie is
 *    sent through the sign-in handoff on the other host (section-handoff.ts),
 *    so they arrive signed in.
 *  - `rewrite-home` and `pass`: the app answers, and the response it makes is
 *    handed back untouched. On a section's host the app is told the section's
 *    home through the request context, and the router's URL rewrite
 *    (section-home-rewrite.ts) shows that page at `/` and writes links to it
 *    as `/`.
 *
 * The host is the one the edge vouches for (`requestWorkspaceHost`), never a
 * forwarded header. Requests that are not pages (the API, server functions,
 * files) skip the settings read altogether. A client-side
 * navigation never reaches this; links that cross sections are the links'
 * job.
 */
import { getWorkspaceSettings } from '@/lib/server/domains/settings/settings.service'
import {
  hostingOf,
  routableSectionDomains,
} from '@/lib/server/domains/settings/section-domains.hosting'
import { config } from '@/lib/server/config'
import { requestWorkspaceHost } from '@/lib/server/workspaces/saas-edge-host'
import {
  effectiveSectionDomains,
  portalSectionsEnabled,
  resolveSectionHostRoute,
  sectionForPath,
  sectionHomeForHost,
} from '@/lib/shared/section-domains'
import { carriesSessionCookie, handoffForMove } from '@/lib/shared/section-handoff'

/** What this middleware tells the app about the request. */
export interface SectionHostContext {
  /** On a section's host, its home: shown at `/`, and written as `/` in links. */
  sectionHome?: string
}

const NOT_A_PAGE_PREFIXES = ['/api/', '/_serverFn/', '/assets/', '/.well-known/']

/** A request no section owns and no page answers: the API, server functions, files. */
function isNotAPage(path: string): boolean {
  if (NOT_A_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix))) return true
  // A file, unless a section owns the path (/hc/sitemap.xml, a slug with a dot).
  const last = path.slice(path.lastIndexOf('/') + 1)
  return last.includes('.') && !sectionForPath(path)
}

interface NextResult {
  response?: Response
}

export async function handleSectionHost<T extends NextResult>({
  request,
  next,
}: {
  request: Request
  next: (opts?: { context: SectionHostContext }) => Promise<T>
}): Promise<T | Response> {
  const url = new URL(request.url)
  if (isNotAPage(url.pathname)) return next()

  const settings = await getWorkspaceSettings()
  if (!settings) return next()

  const map = routableSectionDomains(
    effectiveSectionDomains({
      sectionDomains: settings.portalConfig?.sectionDomains,
      legacyHelpDomain: settings.helpCenterConfig?.domain,
    }),
    hostingOf(settings.settings as { cloud?: unknown; cloudIdentity?: unknown })
  )
  if (Object.keys(map).length === 0) return next()

  const host = requestWorkspaceHost(request)
  const sectionEnabled = portalSectionsEnabled(settings)
  const route = resolveSectionHostRoute({
    host,
    path: url.pathname,
    search: url.search,
    method: request.method,
    map,
    sectionEnabled,
    primaryOrigin: config.baseUrl,
  })

  switch (route.kind) {
    case 'pass':
    case 'rewrite-home': {
      // Every page on a section's host is told its home, so the router writes
      // links to it as `/` on the server as the browser does.
      const sectionHome = sectionHomeForHost({ host, map, sectionEnabled })
      return sectionHome ? next({ context: { sectionHome } }) : next()
    }
    case 'redirect': {
      // A visitor who may be signed in crosses hosts through the handoff, so
      // they arrive signed in: sessions are host-only cookies. Per viewer, so
      // never cached.
      const handoff =
        host && carriesSessionCookie(request.headers.get('cookie'))
          ? handoffForMove(route.location, host)
          : null
      if (handoff) {
        return new Response(null, {
          status: 302,
          headers: { Location: handoff, Vary: 'Host, Cookie', 'Cache-Control': 'no-store' },
        })
      }
      return new Response(null, {
        status: route.status,
        headers: {
          Location: route.location,
          // The answer depends on the session cookie as well (above).
          Vary: 'Host, Cookie',
          // A permanent move is still bounded, so a map changed later is
          // picked up; the other moves follow the map as it is now.
          'Cache-Control': route.status === 301 ? 'public, max-age=3600' : 'no-store',
        },
      })
    }
  }
}
