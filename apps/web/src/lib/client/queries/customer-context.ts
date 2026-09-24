import { queryOptions } from '@tanstack/react-query'
import { fetchCustomerContextFn } from '@/lib/server/functions/customer-context'

/** Customer-context cards for a post author, from connected CRM integrations. */
export function customerContextQuery(email: string) {
  return queryOptions({
    queryKey: ['customer-context', email],
    queryFn: () => fetchCustomerContextFn({ data: { email } }),
    staleTime: 5 * 60 * 1000,
  })
}
