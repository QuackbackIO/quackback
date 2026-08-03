/**
 * Contact queries — search, byOrg, detail, links.
 */
import { queryOptions } from '@tanstack/react-query'
import type { ContactId, OrganizationId } from '@quackback/ids'
import {
  searchContactsFn,
  listContactsForOrganizationFn,
  getContactFn,
  listLinksForContactFn,
} from '@/lib/server/functions/contacts'

const STALE = 30_000

export const contactQueries = {
  all: ['contacts'] as const,
  search: (
    filters: {
      query?: string
      email?: string
      organizationId?: OrganizationId
      includeArchived?: boolean
    } = {}
  ) =>
    queryOptions({
      queryKey: ['contacts', 'search', filters] as const,
      queryFn: () =>
        searchContactsFn({
          data: {
            query: filters.query?.trim() || undefined,
            email: filters.email?.trim() || undefined,
            organizationId: filters.organizationId,
            includeArchived: filters.includeArchived,
            limit: 100,
          },
        }),
      staleTime: STALE,
    }),
  byOrg: (organizationId: OrganizationId, filters: { includeArchived?: boolean } = {}) =>
    queryOptions({
      queryKey: ['contacts', 'byOrg', organizationId, filters] as const,
      queryFn: () =>
        listContactsForOrganizationFn({
          data: {
            organizationId,
            includeArchived: filters.includeArchived,
            limit: 200,
          },
        }),
      staleTime: STALE,
    }),
  detail: (contactId: ContactId) =>
    queryOptions({
      queryKey: ['contacts', 'detail', contactId] as const,
      queryFn: () => getContactFn({ data: { contactId } }),
      staleTime: STALE,
    }),
  links: (contactId: ContactId) =>
    queryOptions({
      queryKey: ['contacts', 'links', contactId] as const,
      queryFn: () => listLinksForContactFn({ data: { contactId } }),
      staleTime: STALE,
    }),
}
