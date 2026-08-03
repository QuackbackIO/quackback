/**
 * TanStack Query factory for routing-rule admin reads. Mirrors `inboxQueries`:
 * route loaders pre-fetch via `ensureQueryData`; components read via
 * `useSuspenseQuery`.
 */
import { queryOptions } from '@tanstack/react-query'
import type { InboxId, RoutingRuleId } from '@quackback/ids'
import { listRoutingRulesFn, getRoutingRuleFn } from '@/lib/server/functions/routing'

export const routingRuleQueries = {
  list: (params: { inboxIdScope?: InboxId | 'workspace'; enabledOnly?: boolean } = {}) =>
    queryOptions({
      queryKey: ['routing-rules', 'list', params] as const,
      queryFn: () => listRoutingRulesFn({ data: params }),
      staleTime: 30_000,
    }),
  detail: (ruleId: RoutingRuleId) =>
    queryOptions({
      queryKey: ['routing-rules', 'detail', ruleId] as const,
      queryFn: () => getRoutingRuleFn({ data: { ruleId } }),
      staleTime: 30_000,
    }),
}
