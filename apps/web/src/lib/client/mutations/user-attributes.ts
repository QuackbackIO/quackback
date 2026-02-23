/**
 * User Attribute mutations
 *
 * React Query mutations for user attribute definition management.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UserAttributeId } from '@quackback/ids'
import {
  createUserAttributeFn,
  updateUserAttributeFn,
  deleteUserAttributeFn,
} from '@/lib/server/functions/admin'

const USER_ATTRIBUTES_KEY = ['admin', 'userAttributes']

/** Create a new user attribute definition. */
export function useCreateUserAttribute() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      key: string
      label: string
      description?: string
      type: 'string' | 'number' | 'boolean' | 'date' | 'currency'
      currencyCode?: 'USD' | 'EUR' | 'GBP' | 'JPY' | 'CAD' | 'AUD' | 'CHF' | 'CNY' | 'INR' | 'BRL'
    }) => createUserAttributeFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_ATTRIBUTES_KEY })
    },
  })
}

/** Update an existing user attribute definition. */
export function useUpdateUserAttribute() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      id: UserAttributeId
      label?: string
      description?: string | null
      type?: 'string' | 'number' | 'boolean' | 'date' | 'currency'
      currencyCode?:
        | 'USD'
        | 'EUR'
        | 'GBP'
        | 'JPY'
        | 'CAD'
        | 'AUD'
        | 'CHF'
        | 'CNY'
        | 'INR'
        | 'BRL'
        | null
    }) => updateUserAttributeFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_ATTRIBUTES_KEY })
    },
  })
}

/** Delete a user attribute definition. */
export function useDeleteUserAttribute() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: UserAttributeId) => deleteUserAttributeFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USER_ATTRIBUTES_KEY })
    },
  })
}
