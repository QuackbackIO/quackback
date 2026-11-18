/**
 * Where the workspace is hosted, as the section map needs to know it: on Cloud
 * a section's hostname must be one of the workspace's custom domains, and it
 * is routed to only while that domain is ready. Pure, so the request
 * middleware can use it without the database.
 */
import { parseIdentityProjection, type IdentityProjection } from './cloud/identity-projection'
import { PORTAL_SECTIONS, type SectionDomainMap } from '@/lib/shared/section-domains'

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

export function readyOnCloud(projection: IdentityProjection | null, hostname: string): boolean {
  return (
    projection?.customDomains.some((d) => d.hostname === hostname && d.readiness === 'ready') ??
    false
  )
}

/**
 * The map as routing should use it. On Cloud a hostname counts as verified
 * only while its custom domain is ready, so a domain removed or failing on the
 * control plane stops receiving visitors at once.
 */
export function routableSectionDomains(map: SectionDomainMap, hosting: Hosting): SectionDomainMap {
  if (!hosting.cloud) return map
  const routable: SectionDomainMap = {}
  for (const section of PORTAL_SECTIONS) {
    const entry = map[section]
    if (!entry) continue
    routable[section] = readyOnCloud(hosting.projection, entry.hostname)
      ? entry
      : { ...entry, verifiedAt: null }
  }
  return routable
}
