/**
 * Company attribute mutations
 *
 * React Query mutations for company attribute definition management.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CompanyAttributeId } from '@quackback/ids'
import {
  createCompanyAttributeFn,
  updateCompanyAttributeFn,
  deleteCompanyAttributeFn,
} from '@/lib/server/functions/companies'

const COMPANY_ATTRIBUTES_KEY = ['admin', 'companyAttributes']

type AttributeType = 'string' | 'number' | 'boolean' | 'date' | 'currency'
type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CHF' | 'CNY' | 'INR' | 'BRL'

/** Create a new company attribute definition. */
export function useCreateCompanyAttribute() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      key: string
      label: string
      description?: string
      type: AttributeType
      currencyCode?: CurrencyCode
      externalKey?: string | null
    }) => createCompanyAttributeFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_ATTRIBUTES_KEY })
    },
  })
}

/** Update an existing company attribute definition. */
export function useUpdateCompanyAttribute() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: CompanyAttributeId
      label?: string
      description?: string | null
      type?: AttributeType
      currencyCode?: CurrencyCode | null
      externalKey?: string | null
    }) => updateCompanyAttributeFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_ATTRIBUTES_KEY })
    },
  })
}

/** Delete a company attribute definition. */
export function useDeleteCompanyAttribute() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: CompanyAttributeId) => deleteCompanyAttributeFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: COMPANY_ATTRIBUTES_KEY })
    },
  })
}
