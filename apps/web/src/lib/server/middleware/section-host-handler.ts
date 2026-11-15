/**
 * Portal sections on their own hostnames (help.acme.com for the help center).
 * The framework binding is section-host.ts; this is the server-only part.
 *
 * Runs after workspace resolution, so the settings read is the workspace's.
 * The decision is `resolveSectionHostRoute` (lib/shared/section-domains.ts):
 *
 *  - `redirect`: answered here, with `Vary: Host`, since the same path answers
 *    differently on each host.
 *  - `rewrite-home`: `/` on a section's host. The app is told the section's
 *    home through the request context, and the router's URL rewrite
 *    (section-home-rewrite.ts) shows that page in place of `/`.
 *  - `pass`: the app answers. The response it makes is handed back untouched.
 *
 * The host is the one the edge vouches for (`requestWorkspaceHost`), never a
 * forwarded header. Paths every host shares (the API, server functions,
 * assets, sign-in, admin) skip the settings read altogether. A client-side
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
} from '@/lib/shared/section-domains'

/** What this middleware tells the app about the request. */
export interface SectionHostContext {
  /** The page to show in place of `/`, on a section's host. */
  sectionHome?: string
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
  if (!sectionForPath(url.pathname)) return next()

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

  const route = resolveSectionHostRoute({
    host: requestWorkspaceHost(request),
    path: url.pathname,
    search: url.search,
    method: request.method,
    map,
    sectionEnabled: portalSectionsEnabled(settings),
    primaryOrigin: config.baseUrl,
  })

  switch (route.kind) {
    case 'pass':
      return next()
    case 'rewrite-home':
      return next({ context: { sectionHome: route.home } })
    case 'redirect':
      return new Response(null, {
        status: route.status,
        headers: {
          Location: route.location,
          Vary: 'Host',
          // A permanent move is still bounded, so a map changed later is
          // picked up; the other moves follow the map as it is now.
          'Cache-Control': route.status === 301 ? 'public, max-age=3600' : 'no-store',
        },
      })
  }
}
