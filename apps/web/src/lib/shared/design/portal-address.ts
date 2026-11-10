/**
 * Where the portal is live, as publishing reports it: the address, and
 * whether to offer a domain of its own. Only Cloud workspaces live on a
 * shared address; a self-hosted portal is already on the owner's domain.
 */
export interface PortalAddress {
  url: string
  /** Offer "Use your own domain": Cloud, no domain set up yet, and allowed to set one. */
  offerDomain: boolean
}

interface CloudIdentity {
  customDomains?: ReadonlyArray<{ readiness: string }> | null
}

export function portalAddress(
  baseUrl: string,
  identity: CloudIdentity | null,
  canManageDomains: boolean
): PortalAddress {
  const hasDomain = (identity?.customDomains ?? []).some((domain) => domain.readiness === 'ready')
  return { url: baseUrl, offerDomain: !!identity && !hasDomain && canManageDomains }
}
