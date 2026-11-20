import { queryOptions } from '@tanstack/react-query'
import {
  getPlanLimitsFn,
  getPlanLimitsNoticeFn,
  getPlanLimitsSummaryFn,
} from '@/lib/server/functions/plan-limits'
import type { PlanLimitsPage } from '@/lib/server/domains/plan-limits/plan-limits.page'
import type { PlanLimitsNotice } from '@/lib/server/domains/plan-limits/plan-limits.notice'

/**
 * The plan limits state. The banner and sidebar line read the summary, or
 * the notice for a teammate without `member.view`; the Plan limits page
 * reads the page with its choosers' candidates. A chooser invalidates `all`,
 * so every surface ticks down together.
 */
export const planLimitsQueries = {
  all: ['plan-limits'] as const,
  summary: () =>
    queryOptions({
      queryKey: ['plan-limits', 'summary'] as const,
      queryFn: () => getPlanLimitsSummaryFn(),
      staleTime: 60_000,
    }),
  /** The banner's read: the summary, or the notice for a teammate without `member.view`. */
  banner: (narrowed: boolean) =>
    queryOptions<PlanLimitsPage | PlanLimitsNotice>({
      queryKey: ['plan-limits', narrowed ? 'notice' : 'summary'] as const,
      queryFn: narrowed ? () => getPlanLimitsNoticeFn() : () => getPlanLimitsSummaryFn(),
      staleTime: 60_000,
    }),
  page: () =>
    queryOptions({
      queryKey: ['plan-limits', 'page'] as const,
      queryFn: () => getPlanLimitsFn(),
      staleTime: 10_000,
    }),
}
