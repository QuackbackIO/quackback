/**
 * Where the workspace is hosted, as the section map needs to know it: on Cloud
 * a section's hostname must be one of the workspace's custom domains, and it
 * is routed to exactly while that domain is ready. Pure, so the request
 * middleware can use it without the database.
 */
import { parseIdentityProjection, type IdentityProjection } from './cloud/identity-projection'
import {
  PORTAL_SECTIONS,
  UNCONFIRMED_GRACE_MS,
  normalizeHost,
  type SectionDomainMap,
} from '@/lib/shared/section-domains'

export interface Hosting {
  cloud: boolean
  /** The Cloud identity; null on Cloud only when it cannot be read. */
  projection: IdentityProjection | null
}

/** Cloud when either the stored capability or the identity says so. */
export function hostingOf(row: { cloud?: unknown; cloudIdentity?: unknown } | null): Hosting {
  const projection = parseIdentityProjection(row?.cloudIdentity)
  const enabled = (row?.cloud as { enabled?: boolean } | null | undefined)?.enabled === true
  return { cloud: enabled || projection !== null, projection }
}

/** The workspace's custom domain for `hostname` while the control plane reports it ready. */
function readyDomain(projection: IdentityProjection | null, hostname: string) {
  const clean = normalizeHost(hostname)
  return (
    projection?.customDomains.find(
      (d) => normalizeHost(d.hostname) === clean && d.readiness === 'ready'
    ) ?? null
  )
}

export function readyOnCloud(projection: IdentityProjection | null, hostname: string): boolean {
  return readyDomain(projection, hostname) !== null
}

/**
 * The map as routing uses it, and links and sign-in with it.
 *
 * On Cloud a hostname is verified exactly while its custom domain is ready on
 * the control plane, whatever was stored when the section was saved: one
 * saved while its domain was pending goes live when the domain turns ready,
 * with no Verify, and one whose domain fails or is removed stops receiving
 * visitors at once. A ready one keeps the time stored when it was verified,
 * or else takes the time the control plane last changed the domain.
 *
 * On a self-hosted server a verification kept without an answer lasts
 * UNCONFIRMED_GRACE_MS at most.
 */
export function routableSectionDomains(
  map: SectionDomainMap,
  hosting: Hosting,
  now: number = Date.now()
): SectionDomainMap {
  if (!hosting.cloud) {
    const routable: SectionDomainMap = {}
    for (const section of PORTAL_SECTIONS) {
      const entry = map[section]
      if (!entry) continue
      const since = entry.unconfirmedSince ? Date.parse(entry.unconfirmedSince) : NaN
      const lapsed = !!entry.unconfirmedSince && !(now - since <= UNCONFIRMED_GRACE_MS)
      routable[section] = lapsed ? { ...entry, verifiedAt: null } : entry
    }
    return routable
  }
  const routable: SectionDomainMap = {}
  for (const section of PORTAL_SECTIONS) {
    const entry = map[section]
    if (!entry) continue
    const domain = readyDomain(hosting.projection, entry.hostname)
    routable[section] = domain
      ? { ...entry, verifiedAt: entry.verifiedAt ?? domain.updatedAt }
      : { ...entry, verifiedAt: null }
  }
  return routable
}
