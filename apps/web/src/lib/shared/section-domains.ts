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
import { isSafeCallbackUrl, isTeamCallback } from './routing'
import type { FeatureFlags, HelpCenterDomainConfig } from './types/settings'
import { isProductEnabled } from './types/settings'
import { isStatusPagePublished } from './status-settings'
import { isPortalSupportSurfaceEnabled } from './support-surfaces'

/** One section's hostname. `verifiedAt` is null until it is known to reach this server. */
export interface SectionDomain {
  hostname: string
  verifiedAt: string | null
  /**
   * Self-hosted only: since when the verification has been kept without an
   * answer (a Verify whose DNS lookup went unanswered, or a daily re-check
   * that found the hostname not reaching this server, `section-domains-watch`).
   * Absent while the hostname is confirmed. Routing keeps a bounded grace;
   * sign-in is never carried there.
   */
  unconfirmedSince?: string | null
}

/**
 * The Custom domains card's id. The card was on Settings > Domains, so old links
 * carry it as /admin/settings/domains#custom-domains (`legacyCustomDomainsTarget`).
 */
export const CUSTOM_DOMAINS_ANCHOR = 'custom-domains'

/** Where one section's hostname stands, as the admin pages name it. */
export type SectionDomainState = 'verified' | 'pending' | 'not-answering'

/**
 * Verified once it reaches this server; pending until then. A verification
 * kept while the hostname does not answer (self-hosted) is "not answering",
 * whether or not its grace has run out.
 */
export function sectionDomainState(entry: SectionDomain): SectionDomainState {
  if (entry.unconfirmedSince) return 'not-answering'
  return entry.verifiedAt ? 'verified' : 'pending'
}

/** How long routing keeps a verification whose lookups go unanswered: the domain ownership grace. */
export const UNCONFIRMED_GRACE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * What the admin pages say about a hostname that stopped answering: that, and
 * the date its grace ends. In UTC, so the server's render and the browser's
 * agree on the day. Null for a hostname that answers.
 */
export function notAnsweringNote(entry: SectionDomain): string | null {
  if (!entry.unconfirmedSince) return null
  const since = Date.parse(entry.unconfirmedSince)
  if (Number.isNaN(since)) return 'Not answering.'
  const by = new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(
    since + UNCONFIRMED_GRACE_MS
  )
  return `Not answering. Fix DNS by ${by}.`
}

/**
 * The map as sign-in may use it: a hostname whose verification is only kept
 * (its lookups go unanswered) counts as unverified. A lapsed or dangling
 * domain may be someone else's now, and a session must never be carried to
 * it, nor a sign-in posted from it trusted.
 */
export function confirmedSectionDomains(map: SectionDomainMap): SectionDomainMap {
  const confirmed: SectionDomainMap = {}
  for (const section of PORTAL_SECTIONS) {
    const entry = map[section]
    if (!entry) continue
    confirmed[section] = entry.unconfirmedSince ? { ...entry, verifiedAt: null } : entry
  }
  return confirmed
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
 * so a feed under /changelog stays a feed. The team pages among them
 * (`PRIMARY_ONLY_PREFIXES`) are answered on the primary domain only.
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

/**
 * The team's pages, which run on the primary domain only: the admin, the
 * setup wizard, the apps embedded in other tools, approving a device, and the
 * OAuth pages (provider consent, integration connect and callback). A section
 * host sends them there. A session made on a section host is portal scope
 * (session-audience.ts), so none of them could work there anyway, and the
 * OAuth ones keep their state cookie on the primary domain.
 */
const PRIMARY_ONLY_PREFIXES = ['/admin', '/onboarding', '/apps', '/device', '/oauth']

/** Whether a path is one of the team's pages, served on the primary domain only. */
function isPrimaryOnlyPath(path: string): boolean {
  return PRIMARY_ONLY_PREFIXES.some((prefix) => underPrefix(path, prefix))
}

/**
 * A team sign-in: the sign-in dialog on `/` (`?auth=signin` or `signup`)
 * asked for on the way to a team page (`/admin`, `/onboarding`, the device and
 * OAuth sign-ins, a team invitation). Every team sign-in redirect lands here,
 * as it did before sections had domains of their own. It must finish on the
 * primary domain: a session made on a section host is a portal session, and
 * the primary domain never sees its cookie. So it is answered on the primary
 * domain, like the team pages, even while a section owns `/`.
 */
function isTeamSignIn(path: string, search: string): boolean {
  if (path !== '/') return false
  const params = new URLSearchParams(search)
  const auth = params.get('auth')
  if (auth !== 'signin' && auth !== 'signup') return false
  const callbackUrl = params.get('callbackUrl')
  if (!isSafeCallbackUrl(callbackUrl)) return false
  const callbackPath = new URL(callbackUrl, 'https://callback.invalid').pathname
  return isPrimaryOnlyPath(callbackPath) || isTeamCallback(callbackUrl)
}

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
  | {
      kind: 'redirect'
      status: 301 | 302
      location: string
      /**
       * False for a team page sent to the primary domain: the move never goes
       * through the sign-in handoff, which would arrive with a portal session.
       */
      carrySession?: false
    }

const PASS: SectionHostRoute = { kind: 'pass' }

function hostOfOrigin(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}

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
 * - The team's pages (`isPrimaryOnlyPath`) on a section's host, on or off,
 *   go (302) to the primary domain, without the sign-in handoff.
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
  const primary = primaryOrigin.replace(/\/$/, '')

  if (isPrimaryOnlyPath(path) || isTeamSignIn(path, search)) {
    // Never a move to itself, should a section ever name the primary host.
    if (!sectionOfHost(host, map) || normalizeHost(hostOfOrigin(primary)) === normalizeHost(host)) {
      return PASS
    }
    return {
      kind: 'redirect',
      status: 302,
      location: `${primary}${path}${search}`,
      carrySession: false,
    }
  }

  const pathSection = sectionForPath(path)
  if (!pathSection) return PASS

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
