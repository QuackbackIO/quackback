/**
 * Custom domains per portal section: help.acme.com for the help center,
 * status.acme.com for status, and so on. Client-safe and pure, so the request
 * middleware, the bootstrap and the router's URL rewrite share one reading of
 * the map.
 *
 * Paths keep their prefix on a section's host (help.acme.com/hc/articles/x);
 * only `/` changes, showing that section's home. One hostname serves at most
 * one section, and a section that is off keeps its mapping while its host
 * sends visitors to the primary domain.
 */
import type { PortalSection } from './custom-domains'
import type { FeatureFlags, HelpCenterDomainConfig } from './types/settings'
import { isProductEnabled } from './types/settings'
import { isStatusPagePublished } from './status-settings'
import { isPortalSupportSurfaceEnabled } from './support-surfaces'

/** One section's hostname. `verifiedAt` is null until it is known to reach this server. */
export interface SectionDomain {
  hostname: string
  verifiedAt: string | null
}

/** The hostname each section is served at. A section without an entry uses the primary domain. */
export type SectionDomainMap = Partial<Record<PortalSection, SectionDomain>>

export const PORTAL_SECTIONS: readonly PortalSection[] = [
  'feedback',
  'roadmap',
  'changelog',
  'help',
  'support',
  'status',
]

/** The page `/` shows on each section's host. */
export const SECTION_HOME: Record<PortalSection, string> = {
  feedback: '/',
  roadmap: '/roadmap',
  changelog: '/changelog',
  help: '/hc',
  support: '/support',
  status: '/status',
}

/**
 * Paths every host serves whatever section it is for: sign-in, the API,
 * account pages, feeds, admin and assets. Checked before the section paths,
 * so a feed under /changelog stays a feed.
 */
const SHARED_PREFIXES = [
  '/api',
  '/auth',
  '/verify-magic-link',
  '/oauth',
  '/.well-known',
  '/widget',
  '/unsubscribe',
  '/portal-invite',
  '/complete-signup',
  '/csat',
  '/device',
  '/settings',
  '/notifications',
  '/u',
  '/robots.txt',
  '/sitemap.xml',
  '/changelog/feed',
  '/changelog/rss',
  '/changelog/rss.xml',
  '/status/feed',
  '/admin',
  '/onboarding',
  '/apps',
  '/assets',
  '/_serverFn',
]

const SECTION_PREFIXES: ReadonlyArray<[string, PortalSection]> = [
  ['/b', 'feedback'],
  ['/roadmap', 'roadmap'],
  ['/changelog', 'changelog'],
  ['/hc', 'help'],
  ['/help', 'help'],
  ['/support', 'support'],
  ['/status', 'status'],
]

function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

/**
 * The section a path belongs to, or null for a path every host shares
 * (including any file such as /favicon.ico).
 */
export function sectionForPath(path: string): PortalSection | null {
  if (path === '/') return 'feedback'
  if (SHARED_PREFIXES.some((prefix) => underPrefix(path, prefix))) return null
  for (const [prefix, section] of SECTION_PREFIXES) {
    if (underPrefix(path, prefix)) return section
  }
  return null
}

/** A host as compared here: lower case, no port, no trailing dot. */
export function normalizeHost(host: string | null | undefined): string | null {
  const value = host?.split(',')[0]?.trim().toLowerCase().split(':')[0]?.replace(/\.$/, '')
  return value ? value : null
}

/** The section a hostname is mapped to, verified or not. */
export function sectionOfHost(
  host: string | null | undefined,
  map: SectionDomainMap
): PortalSection | null {
  const clean = normalizeHost(host)
  if (!clean) return null
  for (const section of PORTAL_SECTIONS) {
    if (normalizeHost(map[section]?.hostname) === clean) return section
  }
  return null
}

/**
 * The map as stored, or, before it was first written, one built from the help
 * center's own domain (the setting it replaces). A stored map, even an empty
 * one, wins: a help domain cleared from the map stays cleared.
 */
export function effectiveSectionDomains({
  sectionDomains,
  legacyHelpDomain,
}: {
  sectionDomains: SectionDomainMap | undefined
  legacyHelpDomain: HelpCenterDomainConfig | null | undefined
}): SectionDomainMap {
  if (sectionDomains) return sectionDomains
  if (!legacyHelpDomain?.domain) return {}
  return { help: { hostname: legacyHelpDomain.domain, verifiedAt: legacyHelpDomain.verifiedAt } }
}

/** The help center's entry in the shape the help center's own readers take. */
export function helpDomainConfig(map: SectionDomainMap): HelpCenterDomainConfig {
  const help = map.help
  return help ? { domain: help.hostname, verifiedAt: help.verifiedAt } : DOMAIN_UNSET
}

const DOMAIN_UNSET: HelpCenterDomainConfig = { domain: null, verifiedAt: null }

/**
 * Whether each section is on for the workspace, from its product switch. The
 * viewer does not enter into it: a section host is on or off for everyone.
 */
export function portalSectionsEnabled({
  featureFlags,
  statusConfig,
  portalConfig,
}: {
  featureFlags: Partial<FeatureFlags> | null | undefined
  statusConfig: { enabled?: boolean } | null | undefined
  portalConfig: { support?: { enabled?: boolean } } | null | undefined
}): Record<PortalSection, boolean> {
  const feedback = isProductEnabled(featureFlags, 'feedback')
  return {
    feedback,
    roadmap: feedback,
    changelog: isProductEnabled(featureFlags, 'changelog'),
    help: isProductEnabled(featureFlags, 'helpCenter'),
    support: isPortalSupportSurfaceEnabled(featureFlags, portalConfig),
    status: isStatusPagePublished(featureFlags, statusConfig),
  }
}

/**
 * The page `/` shows on this host, when that is not the feedback home: the
 * mark the document carries so the browser's router matches the server's.
 */
export function sectionHomeForHost({
  host,
  map,
  sectionEnabled,
}: {
  host: string | null
  map: SectionDomainMap
  sectionEnabled: Record<PortalSection, boolean>
}): string | null {
  const section = sectionOfHost(host, map)
  if (!section || !sectionEnabled[section]) return null
  const home = SECTION_HOME[section]
  return home === '/' ? null : home
}

/**
 * The host a section is served at, when visitors are sent there: its
 * hostname is verified and the section is on. Null keeps it on the primary
 * domain. The map is the routable one (`routableSectionDomains` on the server).
 */
export function routableSectionHost(
  section: PortalSection,
  map: SectionDomainMap,
  sectionEnabled: Record<PortalSection, boolean>
): string | null {
  const entry = map[section]
  return entry?.verifiedAt && sectionEnabled[section] ? normalizeHost(entry.hostname) : null
}

export type SectionHostRoute =
  | { kind: 'pass' }
  /** Serve `home` in place of `/`; the address bar keeps `/`. */
  | { kind: 'rewrite-home'; home: string }
  | { kind: 'redirect'; status: 301 | 302; location: string }

const PASS: SectionHostRoute = { kind: 'pass' }

/**
 * What a request does given the section map.
 *
 * - Shared paths pass on every host.
 * - On a section's host: `/` shows that section's home and its own paths pass.
 *   Another section's path goes (302) to that section's verified host, else to
 *   the primary domain. While the section is off, everything but the shared
 *   paths goes (302) to the primary domain.
 * - On any other host: a section with a verified host, and on, has its paths
 *   moved there (301).
 *
 * Only GET and HEAD are redirected; nothing that changes state is.
 */
export function resolveSectionHostRoute({
  host,
  path,
  search,
  method,
  map,
  sectionEnabled,
  primaryOrigin,
}: {
  host: string | null
  path: string
  search: string
  method: string
  map: SectionDomainMap
  sectionEnabled: Record<PortalSection, boolean>
  primaryOrigin: string
}): SectionHostRoute {
  if (method !== 'GET' && method !== 'HEAD') return PASS
  // A request whose host is unknown cannot be told apart from a section's.
  if (!normalizeHost(host)) return PASS
  const pathSection = sectionForPath(path)
  if (!pathSection) return PASS

  const primary = primaryOrigin.replace(/\/$/, '')
  const routableHost = (section: PortalSection) => routableSectionHost(section, map, sectionEnabled)

  const hostSection = sectionOfHost(host, map)
  if (hostSection) {
    if (!sectionEnabled[hostSection]) {
      return { kind: 'redirect', status: 302, location: `${primary}${path}${search}` }
    }
    if (path === '/') {
      const home = SECTION_HOME[hostSection]
      return home === '/' ? PASS : { kind: 'rewrite-home', home }
    }
    if (pathSection === hostSection) return PASS
    const target = routableHost(pathSection)
    const origin = target ? `https://${target}` : primary
    return { kind: 'redirect', status: 302, location: `${origin}${path}${search}` }
  }

  const target = routableHost(pathSection)
  if (!target) return PASS
  return { kind: 'redirect', status: 301, location: `https://${target}${path}${search}` }
}
