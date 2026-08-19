/**
 * Company attribute query hooks
 */

import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'

export type CompanyAttributeItem = Awaited<
  ReturnType<typeof import('@/lib/server/functions/companies').listCompanyAttributesFn>
>[number]

/** Fetch all company attribute definitions. */
export function useCompanyAttributes() {
  return useQuery(adminQueries.companyAttributes())
}
