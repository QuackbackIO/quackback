/**
 * Where links to each portal section point. A section on its own verified
 * host (help.acme.com for the help center) is linked there directly, so an
 * email, a webhook, a canonical tag or a nav tab never leans on the redirect
 * from the primary domain. Every other section, and every path all hosts
 * share (sign-in, settings, unsubscribe), stays on the primary domain.
 *
 * Client-safe and pure. The server reads the settings once per request or job
 * (`getSectionOrigins` in lib/server/domains/settings/section-links.ts) and
 * the browser gets the same table from the bootstrap.
 */
import type { PortalSection } from './custom-domains'
import {
  PORTAL_SECTIONS,
  routableSectionHost,
  sectionForPath,
  type SectionDomainMap,
} from './section-domains'

/** The origin each section is linked at, and the primary origin for everything else. */
export type SectionOrigins = Record<PortalSection | 'primary', string>

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, '')
}

/**
 * The origin of every section. `map` is the routable map (on Cloud only ready
 * domains count), so links agree with where the middleware routes.
 */
export function sectionOrigins({
  map,
  sectionEnabled,
  primaryOrigin,
}: {
  map: SectionDomainMap
  sectionEnabled: Record<PortalSection, boolean>
  primaryOrigin: string
}): SectionOrigins {
  const primary = trimOrigin(primaryOrigin)
  const result = { primary } as SectionOrigins
  for (const section of PORTAL_SECTIONS) {
    const host = routableSectionHost(section, map, sectionEnabled)
    result[section] = host ? `https://${host}` : primary
  }
  return result
}

/** Every section on the primary domain: no section has a host of its own. */
export function allOnPrimary(primaryOrigin: string): SectionOrigins {
  return sectionOrigins({
    map: {},
    sectionEnabled: {
      feedback: false,
      roadmap: false,
      changelog: false,
      help: false,
      support: false,
      status: false,
    },
    primaryOrigin,
  })
}

/** An absolute URL for a path in one section. Paths keep their prefix on a section host. */
export function sectionUrl(section: PortalSection, path: string, origins: SectionOrigins): string {
  return `${origins[section]}${path.startsWith('/') ? path : `/${path}`}`
}

/** An absolute URL for any portal path, on the host its section is linked at. */
export function portalPageUrl(path: string, origins: SectionOrigins): string {
  const section = sectionForPath(path)
  return section ? sectionUrl(section, path, origins) : `${origins.primary}${path}`
}

/** The sections the primary domain serves itself, in nav order. */
export function sectionsOnPrimary(origins: SectionOrigins): PortalSection[] {
  return PORTAL_SECTIONS.filter((section) => origins[section] === origins.primary)
}
