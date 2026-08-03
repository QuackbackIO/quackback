/**
 * Query factory for SLA admin reads.
 */
import { queryOptions } from '@tanstack/react-query'
import type { SlaPolicyId } from '@quackback/ids'
import {
  listSlaPoliciesFn,
  getSlaPolicyFn,
  listEscalationRulesFn,
} from '@/lib/server/functions/sla'

export const slaQueries = {
  policies: (params: { includeArchived?: boolean } = {}) =>
    queryOptions({
      queryKey: ['sla', 'policies', params] as const,
      queryFn: () => listSlaPoliciesFn({ data: params }),
      staleTime: 30_000,
    }),
  policy: (id: SlaPolicyId) =>
    queryOptions({
      queryKey: ['sla', 'policy', id] as const,
      queryFn: () => getSlaPolicyFn({ data: { id } }),
      staleTime: 30_000,
    }),
  escalations: (policyId: SlaPolicyId) =>
    queryOptions({
      queryKey: ['sla', 'escalations', policyId] as const,
      queryFn: () => listEscalationRulesFn({ data: { policyId } }),
      staleTime: 30_000,
    }),
}
