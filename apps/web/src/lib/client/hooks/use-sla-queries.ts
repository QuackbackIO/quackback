/**
 * SLA + business-hours + escalations + ticket-clocks query hooks.
 */
import { useQuery } from '@tanstack/react-query'
import type { SlaPolicyId, BusinessHoursId, TicketId } from '@quackback/ids'
import {
  listBusinessHoursFn,
  getBusinessHoursFn,
  listSlaPoliciesFn,
  getSlaPolicyFn,
  listEscalationRulesFn,
  getTicketSlaClocksFn,
  listBreachingClocksFn,
} from '@/lib/server/functions/sla'

export const slaKeys = {
  all: ['sla'] as const,
  policies: (includeArchived?: boolean) =>
    [...slaKeys.all, 'policies', { includeArchived }] as const,
  policy: (id: SlaPolicyId) => [...slaKeys.all, 'policy', id] as const,
  escalations: (id: SlaPolicyId) => [...slaKeys.all, 'escalations', id] as const,
  ticketClocks: (ticketId: TicketId) => [...slaKeys.all, 'ticketClocks', ticketId] as const,
  breaching: () => [...slaKeys.all, 'breaching'] as const,
}

export const businessHoursKeys = {
  all: ['businessHours'] as const,
  list: (includeArchived?: boolean) =>
    [...businessHoursKeys.all, 'list', { includeArchived }] as const,
  detail: (id: BusinessHoursId) => [...businessHoursKeys.all, 'detail', id] as const,
}

export function useSlaPolicies(opts: { includeArchived?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: slaKeys.policies(opts.includeArchived),
    queryFn: () => listSlaPoliciesFn({ data: { includeArchived: opts.includeArchived } }),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  })
}

export function useSlaPolicy(id: SlaPolicyId | null | undefined) {
  return useQuery({
    queryKey: id ? slaKeys.policy(id) : ['sla', 'policy', 'none'],
    queryFn: () => getSlaPolicyFn({ data: { id: id! } }),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useEscalationRules(policyId: SlaPolicyId | null | undefined) {
  return useQuery({
    queryKey: policyId ? slaKeys.escalations(policyId) : ['sla', 'escalations', 'none'],
    queryFn: () => listEscalationRulesFn({ data: { policyId: policyId! } }),
    enabled: !!policyId,
    staleTime: 30_000,
  })
}

export function useTicketSlaClocks(ticketId: TicketId | null | undefined) {
  return useQuery({
    queryKey: ticketId ? slaKeys.ticketClocks(ticketId) : ['sla', 'ticketClocks', 'none'],
    queryFn: () => getTicketSlaClocksFn({ data: { ticketId: ticketId! } }),
    enabled: !!ticketId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  })
}

export function useBreachingClocks(enabled = true) {
  return useQuery({
    queryKey: slaKeys.breaching(),
    queryFn: () => listBreachingClocksFn({ data: {} }),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

export function useBusinessHoursList(opts: { includeArchived?: boolean; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: businessHoursKeys.list(opts.includeArchived),
    queryFn: () => listBusinessHoursFn({ data: { includeArchived: opts.includeArchived } }),
    enabled: opts.enabled ?? true,
    staleTime: 60_000,
  })
}

export function useBusinessHours(id: BusinessHoursId | null | undefined) {
  return useQuery({
    queryKey: id ? businessHoursKeys.detail(id) : ['businessHours', 'detail', 'none'],
    queryFn: () => getBusinessHoursFn({ data: { id: id! } }),
    enabled: !!id,
    staleTime: 60_000,
  })
}
