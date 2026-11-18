import { queryOptions } from '@tanstack/react-query'
import { getPlanLimitsFn, getPlanLimitsSummaryFn } from '@/lib/server/functions/plan-limits'

/**
 * The plan limits state. The banner and sidebar line read the summary; the
 * Plan limits page reads the page with its choosers' candidates. A chooser
 * invalidates `all`, so every surface ticks down together.
 */
export const planLimitsQueries = {
  all: ['plan-limits'] as const,
  summary: () =>
    queryOptions({
      queryKey: ['plan-limits', 'summary'] as const,
      queryFn: () => getPlanLimitsSummaryFn(),
      staleTime: 60_000,
    }),
  page: () =>
    queryOptions({
      queryKey: ['plan-limits', 'page'] as const,
      queryFn: () => getPlanLimitsFn(),
      staleTime: 10_000,
    }),
}
