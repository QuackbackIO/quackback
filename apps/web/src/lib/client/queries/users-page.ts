import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  type QueryClient,
} from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  defaultUsersFilters,
  portalUsersInfiniteOptions,
  totalUserCountOptions,
} from '@/lib/client/hooks/use-users-queries'
import { userTagsQueryOptions } from '@/lib/client/hooks/use-user-tags'
import { portalInvitesQueryOptions } from '@/lib/client/queries/portal-invites'
import { parseCompanyFilterParts } from '@/lib/shared/company-filters'
import { countCompaniesFn, listCompaniesPageFn } from '@/lib/server/functions/companies'

/** The companies directory (the people page's Companies tab). */
export const companiesDirectoryQueries = {
  /**
   * Keyset-paginated companies list (capped at 5 pages, like the People
   * list), fetched a page at a time instead of the whole directory at once.
   */
  page: (search: string | undefined, companyAttrs: string | undefined) => {
    const parts = parseCompanyFilterParts(companyAttrs)
    const data = {
      search,
      plan: parts.plan,
      mrr: parts.mrr,
      fields: parts.fields,
      attrs: parts.attrs,
    }
    return infiniteQueryOptions({
      queryKey: ['admin', 'companies', { search, companyAttrs }],
      queryFn: ({ pageParam }) =>
        listCompaniesPageFn({ data: { ...data, cursor: pageParam ?? undefined } }),
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
      maxPages: 5,
      staleTime: 30_000,
      placeholderData: keepPreviousData,
    })
  },

  /** Unfiltered total for the nav badge, a cheap count rather than a list. */
  count: () =>
    queryOptions({
      queryKey: ['admin', 'companies', 'count'],
      queryFn: () => countCompaniesFn(),
      staleTime: 60_000,
    }),
}

/** Team roles that read the companies directory (both presets hold company.view). */
export function canReadCompanies(role: string) {
  return role === 'admin' || role === 'member'
}

/**
 * Warm what the people page reads on every load, for its route loader: the
 * unfiltered people list, the segment and tag filters, the attribute
 * definitions, the nav badge counts and the companies directory. Each is
 * best-effort: a failed read is left to the page's own query.
 */
export function warmUsersPage(queryClient: QueryClient, role: string) {
  const warm = (p: Promise<unknown>) => p.catch(() => undefined)
  const companies = canReadCompanies(role)
  return Promise.all([
    queryClient.ensureInfiniteQueryData(portalUsersInfiniteOptions(defaultUsersFilters)),
    queryClient.ensureQueryData(adminQueries.segments()),
    warm(queryClient.ensureQueryData(totalUserCountOptions('users'))),
    warm(queryClient.ensureQueryData(totalUserCountOptions('leads'))),
    warm(queryClient.ensureQueryData(adminQueries.userAttributes())),
    warm(queryClient.ensureQueryData(adminQueries.companyAttributes())),
    warm(queryClient.ensureQueryData(userTagsQueryOptions())),
    role === 'admin' ? warm(queryClient.ensureQueryData(portalInvitesQueryOptions())) : undefined,
    companies ? warm(queryClient.ensureQueryData(companiesDirectoryQueries.count())) : undefined,
    companies
      ? warm(
          queryClient.ensureInfiniteQueryData(companiesDirectoryQueries.page(undefined, undefined))
        )
      : undefined,
  ])
}
