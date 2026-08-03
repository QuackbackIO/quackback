/**
 * Routing rules query hooks.
 */
import { useQuery } from '@tanstack/react-query'
import type { RoutingRuleId, InboxId } from '@quackback/ids'
import { listRoutingRulesFn, getRoutingRuleFn } from '@/lib/server/functions/routing'

type InboxScope = InboxId | 'workspace' | undefined

export const routingKeys = {
  all: ['routing'] as const,
  list: (filters: { inboxIdScope?: InboxScope; enabledOnly?: boolean }) =>
    [...routingKeys.all, 'list', filters] as const,
  detail: (id: RoutingRuleId) => [...routingKeys.all, 'detail', id] as const,
}

export function useRoutingRules(
  filters: { inboxIdScope?: InboxScope; enabledOnly?: boolean } = {}
) {
  return useQuery({
    queryKey: routingKeys.list(filters),
    queryFn: () =>
      listRoutingRulesFn({
        data: { inboxIdScope: filters.inboxIdScope, enabledOnly: filters.enabledOnly },
      }),
    staleTime: 30_000,
  })
}

export function useRoutingRule(id: RoutingRuleId | null | undefined) {
  return useQuery({
    queryKey: id ? routingKeys.detail(id) : ['routing', 'detail', 'none'],
    queryFn: () => getRoutingRuleFn({ data: { ruleId: id! } }),
    enabled: !!id,
    staleTime: 60_000,
  })
}
