/**
 * What the Custom domains tab of Settings > Portal reads: each section's
 * hostname and the primary domain, and on Cloud the custom domains the
 * operator routes here, whether the plan includes them, and the workspace URL.
 * The Verified domains Add custom domain offers are read only when it opens
 * (`queries/domains.ts`).
 * The tab and the Portal route's loader import this only when the tab is open,
 * so the Design tab neither ships nor fetches it.
 */
import { queryOptions } from '@tanstack/react-query'
import {
  getCloudCustomDomainsFn,
  getCloudIdentityFn,
  hasCustomDomainEntitlementFn,
  type WebAddress,
} from '@/lib/server/functions/cloud-identity'
import {
  getSectionDomainsFn,
  type SectionDomainsView,
} from '@/lib/server/functions/section-domains'

async function loadOperator() {
  const [entitled, domains, cloudIdentity] = await Promise.all([
    hasCustomDomainEntitlementFn(),
    getCloudCustomDomainsFn().catch(() => [] as WebAddress[]),
    getCloudIdentityFn().catch(() => null),
  ])
  return { entitled, domains, cloudIdentity }
}

/** Cloud: the hostnames an operator routes to this workspace, set up on the tab. */
export type CustomDomainsOperator = Awaited<ReturnType<typeof loadOperator>>

export interface PortalCustomDomainsData {
  /** Null when it could not be read. */
  sectionDomains: SectionDomainsView | null
  /** Null off Cloud. */
  operator: CustomDomainsOperator | null
}

export const portalCustomDomainsQueries = {
  tab: (cloud: boolean) =>
    queryOptions({
      queryKey: ['settings', 'portal-custom-domains', cloud],
      // Read ahead on hover, then again only when a change invalidates it.
      staleTime: 30_000,
      queryFn: async (): Promise<PortalCustomDomainsData> => {
        const [sectionDomains, operator] = await Promise.all([
          getSectionDomainsFn().catch(() => null),
          cloud ? loadOperator() : null,
        ])
        return { sectionDomains, operator }
      },
    }),
}
