/**
 * The hostname each portal section is served at (help.acme.com for the help
 * center), kept in `portalConfig.sectionDomains`.
 *
 * On Cloud a section's hostname must be one of the workspace's custom domains,
 * and it is verified while that domain is ready. On a self-hosted server any
 * public name may be given, and it is verified once DNS resolves and this
 * server answers on it, then checked again daily (`section-domains-watch.ts`).
 * Either way the section choice is kept here; the
 * control plane only knows the hostname routes to the workspace.
 *
 * Refusals are returned as values so the settings page can show them.
 */
import { db, settings } from '@/lib/server/db'
import { getBaseUrl } from '@/lib/server/config'
import { logger } from '@/lib/server/logger'
import { normalizeDomain } from '@/lib/server/auth/normalize-domain'
import {
  hostingOf,
  readyOnCloud,
  routableSectionDomains,
  type Hosting,
} from './section-domains.hosting'
import {
  getHelpCenterConfig,
  getPortalConfig,
  getWorkspaceSettings,
  updateHelpCenterConfig,
  updatePortalConfig,
} from './settings.service'
import type { SettingsFreshness } from './settings.helpers'
import {
  effectiveSectionDomains,
  helpDomainConfig,
  hostOfOrigin,
  normalizeHost,
  sectionOfHost,
  storedSectionDomains,
  withoutPrimaryHost,
  type SectionDomainMap,
} from '@/lib/shared/section-domains'
import type { PortalSection } from '@/lib/shared/custom-domains'
import type { HelpCenterDomainStatus } from '@/lib/server/domains/domain-proof/reachability-probe'

const log = logger.child({ component: 'section-domains' })

export type SectionDomainRefusalCode =
  | 'SECTION_DOMAIN_INVALID'
  | 'SECTION_DOMAIN_TAKEN'
  | 'SECTION_DOMAIN_PRIMARY'
  | 'SECTION_DOMAIN_NOT_CUSTOM'
  | 'SECTION_DOMAIN_NOT_ENTITLED'
  | 'SECTION_DOMAIN_CLOUD_UNAVAILABLE'
  | 'SECTION_DOMAIN_NOT_SET'

export interface SectionDomainRefusal {
  ok: false
  code: SectionDomainRefusalCode
  message: string
}

export type SetSectionDomainResult =
  { ok: true; sectionDomains: SectionDomainMap } | SectionDomainRefusal

export type VerifySectionDomainResult =
  | { ok: true; sectionDomains: SectionDomainMap; status: HelpCenterDomainStatus | null }
  | SectionDomainRefusal

function refuse(code: SectionDomainRefusalCode, message: string): SectionDomainRefusal {
  return { ok: false, code, message }
}

/**
 * The map as stored, or the help center's own domain before the map was first
 * written. Only for a write to start from: it keeps an entry that names the
 * primary domain, which every reader leaves out (`getSectionDomains`), so an
 * unrelated change never drops it.
 */
export async function readStoredSectionDomains(
  freshness: SettingsFreshness = 'cached'
): Promise<SectionDomainMap> {
  const [portalConfig, helpCenterConfig] = await Promise.all([
    getPortalConfig(freshness),
    getHelpCenterConfig(freshness),
  ])
  return storedSectionDomains({
    sectionDomains: portalConfig.sectionDomains,
    legacyHelpDomain: helpCenterConfig.domain,
  })
}

/** The primary domain's host now: the one routing sends the primary domain's paths to. */
function currentPrimaryHost(): string | null {
  return hostOfOrigin(getBaseUrl())
}

/** The map as every reader takes it: without a hostname that is the primary domain. */
export async function getSectionDomains(
  freshness: SettingsFreshness = 'cached'
): Promise<SectionDomainMap> {
  return withoutPrimaryHost(await readStoredSectionDomains(freshness), currentPrimaryHost())
}

/** What the Custom domains tab shows: each section's hostname as visitors are routed, and the primary domain. */
export interface SectionDomainsView {
  /**
   * The map as routing reads it: on Cloud a hostname whose custom domain is
   * not ready shows unverified, and on a self-hosted server so does a kept
   * verification past its grace (still marked `unconfirmedSince`).
   */
  sectionDomains: SectionDomainMap
  /** The host every section without its own is served at. */
  primaryHost: string | null
}

/** Read from the workspace settings the request already holds, so the page adds no query. */
export async function getSectionDomainsView(): Promise<SectionDomainsView> {
  const workspace = await getWorkspaceSettings()
  const hosting = hostingOf(
    (workspace?.settings as { cloud?: unknown; cloudIdentity?: unknown } | undefined) ?? null
  )
  const map = effectiveSectionDomains({
    sectionDomains: workspace?.portalConfig?.sectionDomains,
    legacyHelpDomain: workspace?.helpCenterConfig?.domain,
    primaryHost: currentPrimaryHost(),
  })
  return { sectionDomains: routableSectionDomains(map, hosting), primaryHost: primaryHost(hosting) }
}

/** Where the workspace is hosted, read fresh from its settings row. */
export async function readHosting(): Promise<Hosting> {
  return (await readHostingIfSetUp()) ?? hostingOf(null)
}

/** As `readHosting`, or null before the workspace is set up and has no settings row. */
export async function readHostingIfSetUp(): Promise<Hosting | null> {
  const [row] = await db
    .select({ cloud: settings.cloud, cloudIdentity: settings.cloudIdentity })
    .from(settings)
    .limit(1)
  return row ? hostingOf(row) : null
}

/**
 * Writes the whole map. On a self-hosted server the help center's own setting
 * is kept in step for one release, so a server rolled back still has it.
 */
export async function writeSectionDomains(map: SectionDomainMap, hosting: Hosting): Promise<void> {
  await updatePortalConfig({ sectionDomains: map })
  if (!hosting.cloud) await updateHelpCenterConfig({ domain: helpDomainConfig(map) })
}

function primaryHost(hosting: Hosting): string | null {
  const origin = hosting.projection?.canonicalOrigin ?? getBaseUrl()
  try {
    return normalizeHost(new URL(origin).host)
  } catch {
    return null
  }
}

/** Set (or, with null, clear) one section's hostname. */
export async function setSectionDomain(
  section: PortalSection,
  hostnameInput: string | null
): Promise<SetSectionDomainResult> {
  const hosting = await readHosting()
  // As stored, so an entry hidden as the primary domain's is kept (`readStoredSectionDomains`).
  const current = await readStoredSectionDomains('fresh')

  if (hostnameInput === null || hostnameInput.trim() === '') {
    // Clearing is always allowed, so a downgraded workspace is never stuck.
    const next = { ...current }
    delete next[section]
    await writeSectionDomains(next, hosting)
    log.info({ section }, 'section domain cleared')
    return { ok: true, sectionDomains: withoutPrimaryHost(next, currentPrimaryHost()) }
  }

  const hostname = normalizeDomain(hostnameInput)
  if (!hostname) {
    return refuse('SECTION_DOMAIN_INVALID', 'Enter a domain name, such as help.acme.com.')
  }
  const owner = sectionOfHost(hostname, current)
  if (owner && owner !== section) {
    return refuse('SECTION_DOMAIN_TAKEN', `${hostname} is already used for another section.`)
  }
  if (hostname === primaryHost(hosting) || hostname === currentPrimaryHost()) {
    return refuse('SECTION_DOMAIN_PRIMARY', `${hostname} is the primary domain.`)
  }

  let verifiedAt: string | null
  if (hosting.cloud) {
    if (!hosting.projection) {
      return refuse(
        'SECTION_DOMAIN_CLOUD_UNAVAILABLE',
        'Custom domains cannot be read right now. Try again shortly.'
      )
    }
    const { hasEntitlement } = await import('./cloud/entitlements')
    if (!(await hasEntitlement('customDomain'))) {
      return refuse('SECTION_DOMAIN_NOT_ENTITLED', 'Your plan does not include custom domains.')
    }
    const domain = hosting.projection.customDomains.find((d) => d.hostname === hostname)
    if (domain?.isPrimary) {
      return refuse('SECTION_DOMAIN_PRIMARY', `${hostname} is the primary domain.`)
    }
    if (!domain) {
      return refuse('SECTION_DOMAIN_NOT_CUSTOM', `Add ${hostname} as a custom domain first.`)
    }
    verifiedAt = domain.readiness === 'ready' ? new Date().toISOString() : null
  } else {
    // A new hostname has never passed the check; the same one keeps its result.
    const same = current[section]?.hostname === hostname
    verifiedAt = same ? (current[section]?.verifiedAt ?? null) : null
  }

  const next: SectionDomainMap = { ...current, [section]: { hostname, verifiedAt } }
  await writeSectionDomains(next, hosting)
  log.info({ section, hostname, verified: verifiedAt !== null }, 'section domain set')
  // The same domain on Settings > Domains; never a reason to report this write as failed.
  const { ensureDomainForCustomDomain } =
    await import('@/lib/server/domains/domain-proof/ensure-domain')
  await ensureDomainForCustomDomain(hostname)
  return { ok: true, sectionDomains: withoutPrimaryHost(next, currentPrimaryHost()) }
}

/**
 * Check one section's hostname again and keep the result. On a self-hosted
 * server a lookup that went unanswered says nothing about the domain, so it
 * keeps a verification it already has; only an answer can take one away.
 */
export async function verifySectionDomain(
  section: PortalSection
): Promise<VerifySectionDomainResult> {
  const hosting = await readHosting()
  const current = await readStoredSectionDomains('fresh')
  // A hostname that is the primary domain is not a section's to verify.
  const entry = withoutPrimaryHost(current, currentPrimaryHost())[section]
  if (!entry) return refuse('SECTION_DOMAIN_NOT_SET', 'Set a domain before verifying it.')

  let verifiedAt: string | null
  let unconfirmedSince: string | null = null
  let status: HelpCenterDomainStatus | null = null
  if (hosting.cloud) {
    const ready = readyOnCloud(hosting.projection, entry.hostname)
    verifiedAt = ready ? (entry.verifiedAt ?? new Date().toISOString()) : null
  } else {
    const { probeCustomDomain } =
      await import('@/lib/server/domains/domain-proof/reachability-probe')
    const probe = await probeCustomDomain(entry.hostname)
    status = probe.status
    const kept = !status.verified && !probe.dnsAnswered ? entry.verifiedAt : null
    verifiedAt = status.verified ? new Date().toISOString() : kept
    // A kept verification is marked from the first unanswered check: routing
    // keeps its grace for a bounded time, and sign-in is never carried to it
    // (section-domains.ts, `confirmedSectionDomains`).
    if (kept) unconfirmedSince = entry.unconfirmedSince ?? new Date().toISOString()
    log.info(
      { section, hostname: entry.hostname, status, dns_answered: probe.dnsAnswered },
      'section domain verify check'
    )
  }

  const { unconfirmedSince: _previous, ...rest } = entry
  const next: SectionDomainMap = {
    ...current,
    [section]: { ...rest, verifiedAt, ...(unconfirmedSince ? { unconfirmedSince } : {}) },
  }
  await writeSectionDomains(next, hosting)
  return { ok: true, sectionDomains: withoutPrimaryHost(next, currentPrimaryHost()), status }
}
