/**
 * The domains added by name on Settings > Domains, read where a dialog builds
 * on them (Add custom domain, Add sending address) or a row links to one.
 * Readable with any Domains page permission. Its own module, so a page that
 * reads them loads nothing else.
 */
import { queryOptions } from '@tanstack/react-query'
import { listDomainsFn, type AddedDomainSummary } from '@/lib/server/functions/domains'

export const addedDomainsQuery = () =>
  queryOptions({
    queryKey: ['settings', 'added-domains'],
    staleTime: 30_000,
    queryFn: (): Promise<AddedDomainSummary[]> => listDomainsFn(),
  })

/** The names of the Verified domains among them. */
export const verifiedDomainNames = (domains: readonly AddedDomainSummary[]): string[] =>
  domains.filter((d) => d.verified).map((d) => d.name)
