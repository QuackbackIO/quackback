import { queryOptions } from '@tanstack/react-query'
import { fetchOfficeHoursFn } from '@/lib/server/functions/settings'
import { getSlaOfficeHoursFn, listSlaPoliciesFn } from '@/lib/server/functions/sla'

export const officeHoursQuery = queryOptions({
  queryKey: ['settings', 'officeHours'],
  queryFn: () => fetchOfficeHoursFn(),
  staleTime: 5 * 60 * 1000,
})
export const slaPoliciesQuery = queryOptions({
  queryKey: ['settings', 'slaPolicies'],
  queryFn: () => listSlaPoliciesFn(),
  staleTime: 30_000,
})
export const slaOfficeHoursQuery = queryOptions({
  queryKey: ['settings', 'slaOfficeHours'],
  queryFn: () => getSlaOfficeHoursFn(),
  staleTime: 5 * 60 * 1000,
})
