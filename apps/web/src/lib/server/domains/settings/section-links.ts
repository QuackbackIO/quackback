/**
 * Where links to each portal section point, read from the workspace settings.
 * The decision is `sectionOrigins` (lib/shared/section-links.ts); this reads
 * the settings once (they are memoised per request) and applies the same
 * routable map the request middleware routes by, so a link never points at a
 * host that would send the visitor elsewhere.
 */
import { getBaseUrl } from '@/lib/server/config'
import { getWorkspaceSettings } from './settings.service'
import { hostingOf, routableSectionDomains } from './section-domains.hosting'
import type { WorkspaceSettings } from './settings.types'
import {
  confirmedSectionDomains,
  effectiveSectionDomains,
  portalSectionsEnabled,
} from '@/lib/shared/section-domains'
import {
  allOnPrimary,
  sectionOrigins,
  sectionServedAt,
  type SectionOrigins,
} from '@/lib/shared/section-links'

/** The origins from settings already read, as the bootstrap and middleware have them. */
export function sectionOriginsOf(
  settings: Pick<
    WorkspaceSettings,
    'settings' | 'portalConfig' | 'helpCenterConfig' | 'featureFlags' | 'statusConfig'
  > | null,
  primaryOrigin: string,
  { forSignIn = false }: { forSignIn?: boolean } = {}
): SectionOrigins {
  if (!settings) return allOnPrimary(primaryOrigin)
  const routable = routableSectionDomains(
    effectiveSectionDomains({
      sectionDomains: settings.portalConfig?.sectionDomains,
      legacyHelpDomain: settings.helpCenterConfig?.domain,
    }),
    hostingOf(settings.settings as { cloud?: unknown; cloudIdentity?: unknown })
  )
  const map = forSignIn ? confirmedSectionDomains(routable) : routable
  return sectionOrigins({
    map,
    sectionEnabled: portalSectionsEnabled(settings),
    primaryOrigin,
  })
}

/** The origins for this request or job. Call it once and pass the result down. */
export async function getSectionOrigins(): Promise<SectionOrigins> {
  return sectionOriginsOf(await getWorkspaceSettings(), getBaseUrl())
}

/**
 * The origins sign-in may use: trusted origins, the hosts a session is
 * carried to, and the host a sign-in link or provider sign-in comes back to.
 * As `getSectionOrigins`, less any hostname whose verification is only kept
 * because its lookups go unanswered (`confirmedSectionDomains`).
 */
export async function getSignInSectionOrigins(): Promise<SectionOrigins> {
  return sectionOriginsOf(await getWorkspaceSettings(), getBaseUrl(), { forSignIn: true })
}

/**
 * The origin of the routable section host `host` (https://help.acme.com), or
 * null for the primary domain and for any host this workspace does not route
 * a section to. `host` must be the one the edge vouches for
 * (`requestWorkspaceHost`), never a forwarded header.
 */
export async function sectionHostOrigin(host: string | null): Promise<string | null> {
  const origins = await getSignInSectionOrigins()
  const section = sectionServedAt(host, origins)
  return section ? origins[section] : null
}
