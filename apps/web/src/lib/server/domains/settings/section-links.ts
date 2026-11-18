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
import { effectiveSectionDomains, portalSectionsEnabled } from '@/lib/shared/section-domains'
import { allOnPrimary, sectionOrigins, type SectionOrigins } from '@/lib/shared/section-links'

/** The origins from settings already read, as the bootstrap and middleware have them. */
export function sectionOriginsOf(
  settings: Pick<
    WorkspaceSettings,
    'settings' | 'portalConfig' | 'helpCenterConfig' | 'featureFlags' | 'statusConfig'
  > | null,
  primaryOrigin: string
): SectionOrigins {
  if (!settings) return allOnPrimary(primaryOrigin)
  const map = routableSectionDomains(
    effectiveSectionDomains({
      sectionDomains: settings.portalConfig?.sectionDomains,
      legacyHelpDomain: settings.helpCenterConfig?.domain,
    }),
    hostingOf(settings.settings as { cloud?: unknown; cloudIdentity?: unknown })
  )
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
