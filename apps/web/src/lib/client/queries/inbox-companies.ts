import { queryOptions, useQuery } from '@tanstack/react-query'
import { listCompaniesFn } from '@/lib/server/functions/companies'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'

/** Every company, for the inbox's company filter. The inbox route's loader
 *  prefetches it under the key the list header reads. */
export function inboxCompaniesQueryOptions() {
  return queryOptions({
    queryKey: ['admin', 'companies'] as const,
    queryFn: () => listCompaniesFn(),
    staleTime: 60_000,
  })
}

/** The inbox's companies, read only by a viewer holding company.view: for
 *  anyone else there are none, so the company filter stays hidden. */
export function useInboxCompanies() {
  const canView = usePermission(PERMISSIONS.COMPANY_VIEW)
  return useQuery({ ...inboxCompaniesQueryOptions(), enabled: canView })
}
