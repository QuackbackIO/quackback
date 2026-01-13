import { queryOptions } from '@tanstack/react-query'
import { fetchDomainsFn } from '@/lib/server-functions/domains'
import { domainKeys } from '@/lib/hooks/use-domain-actions'

/**
 * Query options factory for domain management.
 * Uses server functions (createServerFn) to keep database code server-only.
 * These are used with ensureQueryData() in loaders and useSuspenseQuery() in components.
 */
export const domainQueries = {
  /**
   * List all domains for the workspace.
   * Returns empty array in self-hosted mode.
   */
  list: () =>
    queryOptions({
      queryKey: domainKeys.lists(),
      queryFn: fetchDomainsFn,
      staleTime: 30 * 1000, // 30s - domains may change status frequently
    }),
}
