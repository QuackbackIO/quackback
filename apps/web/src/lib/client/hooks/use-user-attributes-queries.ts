/**
 * User Attribute query hooks
 */

import { useQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'

export type UserAttributeItem = Awaited<
  ReturnType<typeof import('@/lib/server/functions/admin').listUserAttributesFn>
>[number]

/** Fetch all user attribute definitions. */
export function useUserAttributes() {
  return useQuery(adminQueries.userAttributes())
}
